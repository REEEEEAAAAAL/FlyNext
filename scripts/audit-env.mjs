#!/usr/bin/env node
/**
 * Deployment environment audit.
 *
 * Reports which of the variables a FlyNext deployment needs are present in the
 * current process environment, and whether each one is usable. Values are never
 * printed — only the variable name, a verdict, and remediation advice — so the
 * output is safe to paste into an issue or a build log.
 *
 * The rules mirror `lib/api/upload.ts` and `lib/afs/config.ts` exactly; a change
 * to how either module resolves its configuration should be reflected here.
 *
 * Usage:
 *   node scripts/audit-env.mjs    audit the current environment
 *
 * Exits non-zero when a blocking problem is found, so it can gate a deploy step;
 * advisory findings alone leave the exit code at zero.
 */

/**
 * Verdicts. A `fail` blocks a deployment; a `warn` is worth reading but has a
 * working default.
 */
const VERDICT = {
	ok: "ok",
	warn: "warn",
	fail: "FAIL",
};

/** Read a variable, treating blank and whitespace-only values as unset. */
function read(name) {
	const value = process.env[name];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

/** Placeholders that must be replaced before a deployment will work. */
const PLACEHOLDER_PATTERNS = [
	/change[-_]?me/i,
	/replace[-_]?(with|me)/i,
	/your[-_]/i,
	/^<.*>$/,
	/^\.\.\.$/,
];

function looksLikePlaceholder(value) {
	return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const results = [];

function record(name, verdict, detail) {
	results.push({ name, verdict, detail });
}

/** A required variable that must be present and non-placeholder. */
function checkRequired(name, advice) {
	const value = read(name);
	if (value === undefined) {
		record(name, VERDICT.fail, `not set — ${advice}`);
		return undefined;
	}
	if (looksLikePlaceholder(value)) {
		record(name, VERDICT.fail, `still the template placeholder — ${advice}`);
		return undefined;
	}
	record(name, VERDICT.ok, "set");
	return value;
}

/** A variable whose absence is acceptable but whose value must be sane if set. */
function checkOptional(name, validate, advice) {
	const value = read(name);
	if (value === undefined) {
		record(name, VERDICT.warn, `not set — ${advice}`);
		return undefined;
	}
	const problem = validate(value);
	if (problem !== undefined) {
		record(name, VERDICT.fail, `${problem} — ${advice}`);
		return undefined;
	}
	record(name, VERDICT.ok, "set");
	return value;
}

const DURATION_PATTERN = /^\d+[smhd]?$/;

function checkDuration(name, advice) {
	return checkOptional(
		name,
		(value) =>
			DURATION_PATTERN.test(value)
				? undefined
				: `"${value}" is not a duration such as 1h or 7d`,
		advice
	);
}

// --- Database -----------------------------------------------------------------

const databaseUrl = checkRequired(
	"DATABASE_URL",
	"point it at the deployment database, with ?sslmode=require on a pooled host"
);
if (databaseUrl !== undefined && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
	record(
		"DATABASE_URL",
		VERDICT.fail,
		"must be a postgresql:// connection string"
	);
} else if (databaseUrl !== undefined && !/[?&]sslmode=/.test(databaseUrl)) {
	record(
		"DATABASE_URL",
		VERDICT.warn,
		"no sslmode parameter; managed providers normally require sslmode=require"
	);
}

// --- Authentication -----------------------------------------------------------

const accessSecret = checkRequired("JWT_ACCESS_SECRET", "generate a long random value");
const refreshSecret = checkRequired(
	"JWT_REFRESH_SECRET",
	"generate a different long random value"
);
if (
	accessSecret !== undefined &&
	refreshSecret !== undefined &&
	accessSecret === refreshSecret
) {
	record(
		"JWT_REFRESH_SECRET",
		VERDICT.fail,
		"must differ from JWT_ACCESS_SECRET"
	);
}
for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
	const value = read(name);
	if (value !== undefined && value.length < 32) {
		record(name, VERDICT.warn, `only ${value.length} characters; use 48 bytes of entropy`);
	}
}

checkDuration("JWT_ACCESS_TOKEN_EXPIRY_TIME", "e.g. 1h");
checkDuration("JWT_REFRESH_TOKEN_EXPIRY_TIME", "e.g. 7d");

// --- Flight provider ----------------------------------------------------------
//
// Mirrors `resolveAfsMode()`: AFS_MOCK=true wins, a missing or placeholder
// AFS_BASE_URL selects the offline provider, and AFS_MOCK=false makes a missing
// URL an error rather than a fallback.

const PLACEHOLDER_HOSTS = new Set([
	"afs.invalid",
	"localhost.invalid",
	"example.com",
	"example.org",
	"example.net",
	"replace-me.invalid",
]);

function usableBaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return false;
	}
	return !PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase());
}

const afsMockRaw = read("AFS_MOCK");
const afsForcesOffline =
	afsMockRaw !== undefined && ["1", "true", "yes", "on"].includes(afsMockRaw.toLowerCase());
const afsForcesRemote =
	afsMockRaw !== undefined && afsMockRaw.toLowerCase() === "false";
const afsBaseUrl = read("AFS_BASE_URL");
const afsBaseUrlUsable = afsBaseUrl !== undefined && usableBaseUrl(afsBaseUrl);

if (afsForcesOffline) {
	record(
		"AFS_MOCK",
		VERDICT.ok,
		"offline provider pinned; no AFS service or API key is needed"
	);
} else if (afsForcesRemote) {
	if (afsBaseUrlUsable) {
		record("AFS_MOCK", VERDICT.ok, "remote provider required");
		checkRequired("AFS_API_KEY", "the AFS service rejects calls without it");
	} else {
		record(
			"AFS_MOCK",
			VERDICT.fail,
			'"false" requires a usable AFS_BASE_URL, and none is set'
		);
	}
} else {
	record(
		"AFS_MOCK",
		VERDICT.warn,
		"not set; the back end is chosen from AFS_BASE_URL"
	);
}

if (afsBaseUrl === undefined) {
	record(
		"AFS_BASE_URL",
		VERDICT.warn,
		"not set — the built-in offline provider answers flight traffic"
	);
} else if (!afsBaseUrlUsable) {
	record(
		"AFS_BASE_URL",
		VERDICT.warn,
		`"${afsBaseUrl}" is not a usable http(s) address; the offline provider is used instead`
	);
} else {
	record("AFS_BASE_URL", VERDICT.ok, "remote AFS service configured");
	if (!afsForcesOffline) {
		checkRequired("AFS_API_KEY", "the AFS service rejects calls without it");
	}
}

// --- Image storage ------------------------------------------------------------
//
// Mirrors `readCloudinaryConfig()`: either CLOUDINARY_URL or all three of the
// separate variables, and the three win when both forms are present.

const cloudinaryUrl = read("CLOUDINARY_URL");
const cloudName = read("CLOUDINARY_CLOUD_NAME");
const cloudApiKey = read("CLOUDINARY_API_KEY");
const cloudApiSecret = read("CLOUDINARY_API_SECRET");

const cloudinaryUrlValid =
	cloudinaryUrl !== undefined &&
	/^cloudinary:\/\/[^:@/]+:[^@]+@[^@/]+$/.test(cloudinaryUrl);

if (cloudName !== undefined && cloudApiKey !== undefined && cloudApiSecret !== undefined) {
	record("CLOUDINARY_CLOUD_NAME", VERDICT.ok, "set");
	record("CLOUDINARY_API_KEY", VERDICT.ok, "set");
	record("CLOUDINARY_API_SECRET", VERDICT.ok, "set");
	if (cloudinaryUrl !== undefined && !cloudinaryUrlValid) {
		record(
			"CLOUDINARY_URL",
			VERDICT.warn,
			"malformed and ignored, because the three separate variables take precedence"
		);
	}
} else if (cloudinaryUrlValid) {
	record("CLOUDINARY_URL", VERDICT.ok, "set; used in place of the three variables");
} else if (cloudinaryUrl !== undefined) {
	record(
		"CLOUDINARY_URL",
		VERDICT.fail,
		"malformed; expected cloudinary://<api_key>:<api_secret>@<cloud_name>"
	);
} else {
	if (read("NODE_ENV") === "test" || read("VITEST") === "true") {
		record(
			"CLOUDINARY_*",
			VERDICT.ok,
			"not configured, and uploads are mocked in a test run"
		);
	} else {
		record(
			"CLOUDINARY_*",
			VERDICT.fail,
			"image uploads will answer 502; set CLOUDINARY_URL or the three separate variables"
		);
	}
}

// --- Variables that belong to other environments -------------------------------

if (read("NODE_ENV") === undefined) {
	record("NODE_ENV", VERDICT.warn, "not set; Next.js and Vercel set this themselves");
}
for (const name of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
	if (read(name) !== undefined) {
		record(
			name,
			VERDICT.warn,
			"only the bundled docker-compose stack reads this; a hosted deployment ignores it"
		);
	}
}
if (read("AFS_LOCAL_AGENCY") !== undefined || read("AFS_SEED_DAYS") !== undefined) {
	record(
		"AFS_LOCAL_AGENCY / AFS_SEED_DAYS",
		VERDICT.warn,
		"only the bundled AFS container reads these"
	);
}

// --- Report -------------------------------------------------------------------

const order = { [VERDICT.fail]: 0, [VERDICT.warn]: 1, [VERDICT.ok]: 2 };
const sorted = [...results].sort((a, b) => order[a.verdict] - order[b.verdict]);
const width = Math.max(...sorted.map((entry) => entry.name.length));

const failures = sorted.filter((entry) => entry.verdict === VERDICT.fail);
const warnings = sorted.filter((entry) => entry.verdict === VERDICT.warn);

console.log("FlyNext environment audit");
console.log("=".repeat(78));
for (const entry of sorted) {
	console.log(`${entry.verdict.padEnd(5)} ${entry.name.padEnd(width)}  ${entry.detail}`);
}
console.log("=".repeat(78));
console.log(
	`${sorted.length} checked · ${failures.length} blocking · ${warnings.length} advisory`
);

process.exit(failures.length > 0 ? 1 : 0);
