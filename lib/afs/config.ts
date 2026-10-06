/**
 * Where the AFS flight provider comes from, and how that is decided.
 *
 * `lib/afs-client.ts` has two interchangeable back ends behind one contract:
 *
 * - remote — HTTP against a real AFS server. Either a container started from
 *   this repository's `docker-compose.yml` (`http://afs:3000`) or any other
 *   deployment of <https://github.com/Kianoosh76/afs>.
 * - offline — the in-process implementation in `lib/afs/offline.ts`, which
 *   serves the same payloads with no network at all. It is what keeps search,
 *   booking, ticketing and refund/compensation flows working in CI and on
 *   Vercel, where an AFS container running on a local machine is not reachable.
 *
 * The decision is made per call rather than at import time, because route
 * handlers are imported once and a module-level choice would freeze the first
 * value seen — which makes the mode impossible to change in a test.
 */

/** Base URL of the AFS service this repository ships for local development. */
export const LOCAL_AFS_BASE_URL = "http://localhost:4000";

/** Base URL of the AFS container as seen from the `nextjs` container. */
export const DOCKER_AFS_BASE_URL = "http://afs:3000";

/**
 * Hosts that are placeholders rather than services.
 *
 * `.env.test` points `AFS_BASE_URL` at `https://afs.invalid` precisely so that an
 * accidental real call fails; treating it as a live provider would turn every
 * flight search in the suite into a `502`. The same applies to the documentation
 * addresses in `.env.example`: they are there to be replaced, and a deployment
 * that forgets to replace them is better served by the offline implementation
 * than by DNS failures.
 */
const PLACEHOLDER_HOSTS = new Set([
	"afs.invalid",
	"localhost.invalid",
	"example.com",
	"example.org",
	"example.net",
	"replace-me.invalid",
]);

/** True when `value` is `1`, `true`, `yes` or `on`, case-insensitively. */
function isAffirmative(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * A usable `AFS_BASE_URL`, or `undefined` when there is none.
 *
 * Only `http`/`https` URLs pointing at something that is not a documented
 * placeholder count. A value such as `afs.internal:4000` (no scheme, so not a
 * URL) or `https://afs.invalid` is a configuration mistake, and reporting it as
 * "no usable URL" is what lets the offline implementation take over instead of
 * failing every request with `502`.
 */
export function resolveAfsBaseUrl(): string | undefined {
	const raw = process.env.AFS_BASE_URL?.trim();
	if (raw === undefined || raw.length === 0) {
		return undefined;
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return undefined;
	}
	if (PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) {
		return undefined;
	}
	return raw.replace(/\/+$/, "");
}

/** Which back end the AFS client should use for a given call. */
export type AfsMode = "remote" | "offline";

/** Why {@link resolveAfsMode} chose the mode it did; surfaced in logs. */
export type AfsModeReason =
	| "forced-offline"
	| "forced-remote"
	| "no-usable-base-url"
	| "remote-configured";

export interface AfsModeResolution {
	mode: AfsMode;
	reason: AfsModeReason;
	/** The remote base URL, present only when {@link mode} is `remote`. */
	baseUrl?: string;
}

/**
 * Decide between the remote AFS service and the offline implementation.
 *
 * Precedence, highest first:
 *
 * 1. `AFS_MOCK=true` — an explicit request for the offline implementation. It
 *    wins over a configured URL so that CI and Vercel can pin the behaviour
 *    without touching `AFS_BASE_URL`.
 * 2. `AFS_MOCK=false` — an explicit request for HTTP. This is the only way to
 *    require the remote service: with it set, a missing or placeholder
 *    `AFS_BASE_URL` is an error rather than a silent downgrade.
 * 3. No usable `AFS_BASE_URL` — offline, because there is nowhere to call.
 * 4. Otherwise remote.
 */
export function resolveAfsMode(): AfsModeResolution {
	const baseUrl = resolveAfsBaseUrl();
	const flag = process.env.AFS_MOCK;

	if (isAffirmative(flag)) {
		return { mode: "offline", reason: "forced-offline" };
	}
	if (baseUrl === undefined) {
		return { mode: "offline", reason: "no-usable-base-url" };
	}
	if (flag !== undefined && flag.trim().toLowerCase() === "false") {
		return { mode: "remote", reason: "forced-remote", baseUrl };
	}
	return { mode: "remote", reason: "remote-configured", baseUrl };
}

/**
 * True when AFS calls are served by the in-process implementation.
 *
 * Exposed so that a route handler, a health check or a test can assert which
 * back end is in play without duplicating the precedence rules.
 */
export function isAfsOffline(): boolean {
	return resolveAfsMode().mode === "offline";
}
