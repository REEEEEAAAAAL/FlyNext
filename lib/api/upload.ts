/**
 * Image upload handling for hotel logos, room-type galleries and avatars.
 *
 * Images are stored on Cloudinary, not on the local filesystem. The serverless
 * target (Vercel) gives a function a read-only, per-invocation filesystem, so a
 * `writeFile(public/uploads/…)` implementation cannot work there at all: the write
 * either fails outright or lands in an ephemeral layer that the next request cannot
 * see. Cloudinary is the store of record, and only the absolute `https://` URL it
 * returns is persisted.
 *
 * Four rules apply to everything written here:
 *
 * 1. The caller never chooses the identity of the asset. The stored format is
 *    derived from the validated MIME type and the public ID suffix is a
 *    server-generated UUID, so a `file.name` such as `a./../../evil.js` cannot
 *    influence what is stored or where it is stored.
 * 2. Credentials are read per call, never at module scope. `next build`
 *    evaluates route modules to collect their metadata, and a module-scope read
 *    would either bake a secret into the build output or crash the build when the
 *    secret is absent — which is exactly the case on a CI runner.
 * 3. A missing configuration degrades, it does not crash. Under test (`npm
 *    test`) or in CI the upload is mocked, so the integration suite exercises the
 *    whole request path without a network dependency and without writing
 *    production assets. Outside those environments a missing configuration is a
 *    genuine misconfiguration and is reported as an upstream failure.
 * 4. Failures are upstream failures. A rejected or unreachable Cloudinary is
 *    reported as `502`, never as a `400`: the caller's request was well formed.
 *
 * Placement is decided by {@link planUpload} and never left to chance: every
 * asset is written under the configured root folder and its bucket, and an
 * unusable `CLOUDINARY_FOLDER` falls back to {@link DEFAULT_FOLDER} instead of
 * dropping the asset at the account root. See {@link normaliseFolder}.
 */

import { v2 as cloudinary } from "cloudinary";
import { badGateway, badRequest, toErrorMessage } from "./errors";

/** Upload buckets, used as the Cloudinary sub-folder for each kind of image. */
export type UploadBucket = "hotels" | "roomTypes" | "userProfiles";

/** Maximum accepted upload size: 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Accepted image MIME types mapped to the format Cloudinary stores.
 *
 * `image/jpg` is non-standard but is emitted by some clients, so it stays
 * accepted for backwards compatibility.
 */
const ALLOWED_IMAGE_TYPES: Readonly<Record<string, string>> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/** Cloudinary credentials, resolved lazily so a build never needs them. */
export interface CloudinaryConfig {
	cloudName: string;
	apiKey: string;
	apiSecret: string;
	/** Root folder every bucket is nested under. */
	folder: string;
}

/** The folder used when `CLOUDINARY_FOLDER` is unset, blank or unusable. */
const DEFAULT_FOLDER = "flynext";

/**
 * Reduce a configured `CLOUDINARY_FOLDER` to a usable relative folder path.
 *
 * The value comes from the deployment, not from a request, but it still must not
 * be able to move an asset out of the account's folder tree or break the asset's
 * public ID: `"/"` would produce the leading-slash public ID `//hotels/<uuid>`,
 * `"flynext/"` a doubled separator, and `"../x"` a relative segment. Empty
 * segments and `.`/`..` are dropped, so a value that leaves nothing usable — an
 * empty string, `"/"`, `".."`, whitespace — resolves to {@link DEFAULT_FOLDER}
 * rather than to the account root.
 */
export function normaliseFolder(raw: string | undefined): string {
	const segments = (raw ?? "")
		.split("/")
		.map((segment) => segment.trim())
		.filter(
			(segment) => segment.length > 0 && segment !== "." && segment !== ".."
		);
	return segments.length === 0 ? DEFAULT_FOLDER : segments.join("/");
}

/** First non-blank environment value, so `KEY=""` counts as unset. */
function readEnv(...names: readonly string[]): string {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value !== undefined && value.length > 0) {
			return value;
		}
	}
	return "";
}

/**
 * Read the Cloudinary credentials from the environment, or `undefined` when the
 * deployment has not been given any.
 *
 * `CLOUDINARY_URL` (`cloudinary://<key>:<secret>@<cloud_name>`) is accepted as an
 * alternative to the three separate variables, because that is the single value
 * the Cloudinary dashboard offers for copy-paste. It is parsed here rather than
 * handed to `cloudinary.config({ cloudinary_url })`, so that every field is
 * validated the same way whichever form the deployment used.
 *
 * `folder` is normalised and defaulted on every path, so no configuration can
 * leave it blank — an empty root folder is what would scatter uploads across the
 * account root.
 */
export function readCloudinaryConfig(): CloudinaryConfig | undefined {
	const url = readEnv("CLOUDINARY_URL");
	const folder = normaliseFolder(readEnv("CLOUDINARY_FOLDER"));
	if (url.length > 0) {
		// `[^@]+` for the credentials: an api_secret may legitimately contain `:`,
		// so only the last `@` may be treated as the host separator.
		const match = /^cloudinary:\/\/([^:@/]+):([^@]+)@([^@/]+)$/.exec(url);
		if (match !== null) {
			const [, apiKey, apiSecret, cloudName] = match;
			return {
				cloudName,
				apiKey,
				apiSecret,
				folder,
			};
		}
	}

	const cloudName = readEnv("CLOUDINARY_CLOUD_NAME");
	const apiKey = readEnv("CLOUDINARY_API_KEY");
	const apiSecret = readEnv("CLOUDINARY_API_SECRET");
	if (cloudName.length === 0 || apiKey.length === 0 || apiSecret.length === 0) {
		return undefined;
	}

	return {
		cloudName,
		apiKey,
		apiSecret,
		folder,
	};
}

/**
 * Whether uploads should be mocked instead of hitting Cloudinary.
 *
 * Two independent conditions, both required:
 *
 * - the deployment has no usable credentials, and
 * - it is a test run (`NODE_ENV=test`, Vitest, or CI).
 *
 * Requiring both is the point. Mocking whenever credentials are absent would let
 * a misconfigured production deployment advertise `/uploads/...` URLs that no
 * request can ever serve — a silent data-integrity bug. The reverse (testing
 * against the real account) is just as bad: the suite would create assets in the
 * production cloud on every run. Outside a test run the missing configuration is
 * surfaced, which is what makes it fixable.
 */
export function isUploadMocked(): boolean {
	if (readCloudinaryConfig() !== undefined) {
		return false;
	}
	return (
		process.env.NODE_ENV === "test" ||
		process.env.VITEST === "true" ||
		typeof process.env.CI === "string"
	);
}

/** True when `file` is an image type this project accepts. */
export function isAllowedImageType(file: File): boolean {
	return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, file.type);
}

/**
 * True when `url` is already an absolute, browser-resolvable address.
 *
 * Pages have to distinguish a stored Cloudinary URL from a bundled placeholder
 * such as `/hotel-logo-default.svg`; prefixing the former with a slash turns a
 * valid address into a 404.
 */
export function isAbsoluteImageUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

/** The URL returned for `file` when the upload is mocked. */
function mockUrl(bucket: UploadBucket, format: string): string {
	return `/uploads/${bucket}/mock-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 10)}.${format}`;
}

/**
 * The account's folder mode, as Cloudinary reports it.
 *
 * `"unknown"` means the mode could not be read, and is treated exactly like
 * `"fixed"`: the placement rule that both modes honour.
 */
export type FolderMode = "fixed" | "dynamic" | "unknown";

/**
 * The placement options for one upload, already resolved.
 *
 * A union rather than optional fields so that the dynamic-folder branch always
 * carries the prefix flag with it — the two only make sense together.
 */
export type UploadPlacement =
	| { publicId: string }
	| { publicId: string; folder: string; useAssetFolderAsPublicIdPrefix: true };

/**
 * Decide where one uploaded asset goes.
 *
 * Cloudinary accounts come in two folder modes, and each one reads placement
 * from a different field, so the same request cannot name the folder the same
 * way in both:
 *
 * - Dynamic folders read the `folder` parameter. The public ID is kept a bare
 *   UUID, because a public ID that repeated the path would nest the asset twice
 *   (`<root>/<bucket>/<root>/<bucket>/<uuid>`), and
 *   `use_asset_folder_as_public_id_prefix` is passed explicitly so the stored
 *   public ID — and therefore the delivery URL — still has the documented
 *   `<root>/<bucket>/<uuid>` shape.
 * - Fixed folders (and any account whose mode could not be read) ignore
 *   `folder` entirely: the prefix of the public ID is the placement. That is
 *   why the fallback carries the path rather than trusting a parameter that may
 *   be dropped — a dropped parameter would put the asset at the account root.
 *
 * Pure on purpose: the rule is the part worth testing, and it can be tested
 * exhaustively without a Cloudinary account.
 */
export function planUpload(
	root: string,
	bucket: UploadBucket,
	mode: FolderMode,
	uuid: string
): UploadPlacement {
	const path = `${normaliseFolder(root)}/${bucket}`;
	if (mode === "dynamic") {
		return { publicId: uuid, folder: path, useAssetFolderAsPublicIdPrefix: true };
	}
	return { publicId: `${path}/${uuid}` };
}

/**
 * The account's folder mode, resolved at most once per process.
 *
 * A definitive answer is cached: both `"fixed"` and `"dynamic"`, and also a
 * response that reports no mode at all — an account that does not answer the
 * question is placed with the rule both modes honour, and asking again on every
 * upload would only add latency. A failed call is deliberately not cached, so a
 * transient Admin API outage does not pin every later upload to a guess for the
 * lifetime of the process. Credentials are passed per call for the same reason as
 * everywhere else in this module — nothing is read at module scope, so
 * `next build` never needs (or captures) a secret.
 */
let folderModeRequest: Promise<FolderMode> | undefined;

async function accountFolderMode(
	config: CloudinaryConfig
): Promise<FolderMode> {
	if (folderModeRequest !== undefined) {
		return folderModeRequest;
	}
	try {
		const response = await cloudinary.api.config({
			settings: true,
			cloud_name: config.cloudName,
			api_key: config.apiKey,
			api_secret: config.apiSecret,
		});
		const mode = response?.settings?.folder_mode;
		const resolved: FolderMode =
			mode === "dynamic" || mode === "fixed" ? mode : "fixed";
		folderModeRequest = Promise.resolve(resolved);
		return resolved;
	} catch {
		// An Admin API that cannot be reached or authorised is not a reason to
		// fail the upload: `"unknown"` selects the mode-agnostic placement, and the
		// next upload asks again.
	}
	return "unknown";
}

/**
 * Send one validated buffer to Cloudinary and resolve with its HTTPS URL.
 *
 * `upload_stream` is used rather than `upload` because `upload` accepts only a
 * filesystem path or a remote URL — neither exists for an incoming multipart
 * part on a serverless host. The buffer is written into the stream and the
 * `end()` call is what makes Cloudinary start processing it.
 */
async function uploadBuffer(
	config: CloudinaryConfig,
	buffer: Buffer,
	bucket: UploadBucket,
	format: string
): Promise<string> {
	const placement = planUpload(
		config.folder,
		bucket,
		await accountFolderMode(config),
		crypto.randomUUID()
	);

	const uploaded = await new Promise<{ url: string; secureUrl: string }>(
		(resolve, reject) => {
			const stream = cloudinary.uploader.upload_stream(
				{
					cloud_name: config.cloudName,
					api_key: config.apiKey,
					api_secret: config.apiSecret,
					resource_type: "image",
					// The derived extension is authoritative: the caller-supplied
					// filename is never read, so it cannot smuggle in another format.
					format,
					public_id: placement.publicId,
					// Declared only in the mode that honours it; see `planUpload`.
					...("folder" in placement
						? {
								folder: placement.folder,
								use_asset_folder_as_public_id_prefix:
									placement.useAssetFolderAsPublicIdPrefix,
							}
						: {}),
					// The public ID is already a UUID, so Cloudinary must not append a
					// second random suffix — otherwise the ID in the URL stops matching
					// the asset that was requested.
					unique_filename: false,
					overwrite: false,
					// Nothing may be cached under a replaced public ID.
					invalidate: true,
				},
				(error, result) => {
					if (error !== undefined && error !== null) {
						reject(new Error(error.message ?? "Cloudinary rejected the upload"));
						return;
					}
					if (result === undefined || result === null) {
						reject(new Error("Cloudinary returned no result"));
						return;
					}
					resolve({ url: result.url, secureUrl: result.secure_url });
				}
			);
			stream.on("error", reject);
			stream.end(buffer);
		}
	);

	// A project with "strict secure distribution" disabled can be answered with an
	// `http://` `secure_url`; upgrade rather than storing a mixed-content URL that
	// the browser would block on every HTTPS page.
	return uploaded.secureUrl.replace(/^http:\/\//i, "https://");
}

/**
 * Validate and persist one uploaded image.
 *
 * @returns the URL to store on the record — an absolute Cloudinary
 * `https://res.cloudinary.com/...` address, or a mock path under test.
 * @throws ApiError `400` when the type or size is rejected, `502` when
 * Cloudinary is unreachable or refuses the asset.
 */
export async function saveImageUpload(
	file: File,
	bucket: UploadBucket
): Promise<string> {
	const format = ALLOWED_IMAGE_TYPES[file.type];
	if (format === undefined) {
		throw badRequest(
			"Invalid file type. Only JPEG, PNG, and WebP images are allowed."
		);
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		throw badRequest("File size exceeds the size limit (5MB).");
	}

	// An empty part is a form artefact, not a file the user chose. Returning a URL
	// for it would write a zero-byte asset into the account.
	if (file.size === 0) {
		throw badRequest("The uploaded file is empty.");
	}

	if (isUploadMocked()) {
		// No credentials in a test run: hand back a path under `public/uploads/`,
		// the shape a disk-backed implementation would return, so the assertions
		// that only care about "a new image URL was returned" keep working without
		// a network call.
		return mockUrl(bucket, format);
	}

	const config = readCloudinaryConfig();
	if (config === undefined) {
		throw badGateway(
			"Image storage is not configured.",
			"Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET " +
				"(or CLOUDINARY_URL)."
		);
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	try {
		// The public ID (and, on a dynamic-folder account, the folder parameter)
		// is built inside the upload, from the configured root and the bucket.
		return await uploadBuffer(config, buffer, bucket, format);
	} catch (error) {
		// The cause is safe to expose to an operator via `details` (Cloudinary
		// reports the reason and a request id, never the api_secret), and it is the
		// only way to tell a bad credential from a transient outage.
		throw badGateway("Image upload failed.", toErrorMessage(error));
	}
}

/**
 * Persist several images, preserving the caller's ordering.
 *
 * Uploads run sequentially rather than in parallel: each one holds a
 * multi-megabyte buffer, and serialising keeps peak memory bounded no matter how
 * many files a single request carries. On a serverless host the memory ceiling is
 * a hard limit, so a parallel fan-out over a large gallery is what turns a
 * legitimate request into an out-of-memory crash.
 */
export async function saveImageUploads(
	files: readonly File[],
	bucket: UploadBucket
): Promise<string[]> {
	const urls: string[] = [];
	for (const file of files) {
		urls.push(await saveImageUpload(file, bucket));
	}
	return urls;
}

/**
 * Resolve a `FormData` image list that mixes retained URLs and new uploads.
 *
 * The hotel and room-type edit forms append one entry per image to a single
 * `images` key — either the existing URL string or a newly chosen `File`. The
 * relative order is meaningful (it is the gallery order), so the entries must be
 * walked in one pass rather than split into two `getAll` calls.
 *
 * @param formData the submitted form
 * @param field the repeated form key, normally `"images"`
 * @param bucket Cloudinary sub-folder for the entries that are new uploads
 */
export async function resolveImageEntries(
	formData: FormData,
	field: string,
	bucket: UploadBucket
): Promise<string[]> {
	const urls: string[] = [];
	for (const entry of formData.getAll(field)) {
		if (typeof entry === "string") {
			const trimmed = entry.trim();
			if (trimmed.length > 0) {
				urls.push(trimmed);
			}
			continue;
		}
		if (entry.size > 0) {
			urls.push(await saveImageUpload(entry, bucket));
		}
	}
	return urls;
}
