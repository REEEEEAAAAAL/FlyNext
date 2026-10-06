/**
 * In-process request rate limiting.
 *
 * The API is served by a single Next.js process and has no Redis, no gateway and
 * no other shared infrastructure, so the budget for a client is tracked in this
 * module's memory. That is a deliberate trade-off:
 *
 * - it is exact for one process and degrades gracefully if the app is ever scaled
 *   out (each instance enforces its own share of the budget rather than none);
 * - it adds no dependency and no network hop to a request path that includes a
 *   endpoint polled every five seconds;
 * - it resets on deploy, which is harmless because every rule is a burst limit,
 *   not a quota.
 *
 * What it protects against is the traffic pattern the API actually sees: a login
 * form being brute-forced, a badly behaved tab polling in a tight loop, and a
 * client replaying a booking or checkout write. None of those needs cluster-wide
 * accounting to be stopped.
 *
 * ## Algorithm
 *
 * A fixed window per key. The window is a bucket of time, not a sliding log: the
 * counter simply resets when the bucket ends. Compared with a token bucket it is
 * a few lines instead of a timer per key, and compared with a sliding log it is
 * `O(1)` memory per key instead of `O(limit)` — worth having when the key is an
 * IP address chosen by an attacker.
 *
 * The known weakness of fixed windows is that a caller can fit two windows' worth
 * of requests around a boundary. For abuse and overload control that burst is
 * acceptable, and the alternative costs a sorted timestamp list per key.
 */

import type { NextRequest } from "next/server";
import { getAuthContext } from "./auth";
import { jsonError } from "./response";

/** A rate limiting rule. */
export interface RateLimitRule {
	/** Bucket width in milliseconds. */
	readonly windowMs: number;
	/** Requests allowed per bucket, per key. */
	readonly max: number;
}

/**
 * Every rule the API applies, named rather than inlined at the call site so that
 * budgets can be reviewed side by side and overridden from tests.
 */
export const RATE_LIMITS = {
	/** Credential checks: tight, because each request is a password guess. */
	login: { windowMs: 60_000, max: 10 },
	/** Account creation: an order of magnitude below login, to stop mass signup. */
	register: { windowMs: 60 * 60_000, max: 10 },
	/** Token exchange hits the database on every 401 recovery. */
	refresh: { windowMs: 60_000, max: 30 },
	/** Profile reads: several pages fetch this twice on mount. */
	profileRead: { windowMs: 60_000, max: 120 },
	/** Profile writes, including an avatar upload. */
	profileWrite: { windowMs: 60_000, max: 20 },
	/** The nav badge polls this every five seconds, i.e. 12 requests a minute. */
	notificationPoll: { windowMs: 60_000, max: 40 },
	/** Listing notifications is a table scan per request. */
	notificationRead: { windowMs: 60_000, max: 60 },
	/** Hotel, flight and itinerary writes: replay and double-submit protection. */
	bookingWrite: { windowMs: 60_000, max: 30 },
	/** Checkout: one order, so a much tighter ceiling than the other writes. */
	checkout: { windowMs: 60_000, max: 10 },
	/** Outbound flight search, which is the slowest call in the system. */
	flightSearch: { windowMs: 60_000, max: 60 },
	/** Public hotel catalogue. */
	publicRead: { windowMs: 60_000, max: 240 },
} as const satisfies Record<string, RateLimitRule>;

/** Name of a rule in {@link RATE_LIMITS}. */
export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Ceiling on the number of keys held in memory.
 *
 * A fixed window makes a key self-expiring, but without a cap a caller cycling
 * through source addresses could still grow the map faster than lazy eviction
 * reclaims it. Once the map is full, the oldest entries are dropped: shedding
 * state for an idle client is preferable to shedding memory.
 */
const MAX_TRACKED_KEYS = 20_000;

/** Setting this to `"1"` disables every rule. Used by the test suite's fixtures. */
const DISABLE_FLAG = "RATE_LIMIT_DISABLED";

/** The bucket for one key inside one window. */
interface Counter {
	/** Start of the current window, in epoch milliseconds. */
	windowStart: number;
	/** Requests seen in the current window. */
	count: number;
}

const counters = new Map<string, Counter>();

/** Budgets in force. Replaced wholesale by the test suite, otherwise as declared. */
let rules: Record<string, RateLimitRule> = { ...RATE_LIMITS };

/** Raised when a caller has spent its budget. */
export class RateLimitExceededError extends Error {
	/** Seconds until the current window ends. */
	readonly retryAfterSeconds: number;

	constructor(retryAfterSeconds: number) {
		super("Too many requests");
		this.name = "RateLimitExceededError";
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * Derive the client address from the forwarding headers.
 *
 * `x-forwarded-for` is caller-controlled unless a trusted proxy overwrites it, so
 * the left-most entry is the only one that can plausibly be the origin. Rate
 * limiting on a spoofable value is still worthwhile — it raises the cost of the
 * trivial attack — but it is the reason every rule additionally identifies
 * authenticated callers by user id, which cannot be forged.
 */
export function getClientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded !== null && forwarded.length > 0) {
		const first = forwarded.split(",")[0]?.trim() ?? "";
		if (first.length > 0) {
			return first;
		}
	}
	const realIp = request.headers.get("x-real-ip");
	if (realIp !== null && realIp.trim().length > 0) {
		return realIp.trim();
	}
	return "unknown";
}

/**
 * Identity a request is billed to.
 *
 * A valid access token wins over the address, so one user sharing a NAT with
 * hundreds of others does not exhaust a shared budget, and a user cannot escape
 * their own budget by changing address.
 */
export function rateLimitKey(request: Request): string {
	const context = getAuthContext(request);
	if (context !== null) {
		return `user:${context.userId}`;
	}
	return `ip:${getClientIp(request)}`;
}

/**
 * Consume one unit of `name`'s budget for `key`.
 *
 * @throws RateLimitExceededError when the budget for the current window is gone.
 */
export function consumeRateLimit(key: string, name: RateLimitName): void {
	if (process.env[DISABLE_FLAG] === "1") {
		return;
	}
	const rule = rules[name];
	if (rule === undefined) {
		return;
	}

	const now = Date.now();
	const counter = counters.get(key);

	if (counter === undefined || now - counter.windowStart >= rule.windowMs) {
		if (counters.size >= MAX_TRACKED_KEYS) {
			evictOldest();
		}
		counters.set(key, { windowStart: now, count: 1 });
		return;
	}

	counter.count += 1;
	if (counter.count > rule.max) {
		const elapsed = now - counter.windowStart;
		const remainingMs = Math.max(rule.windowMs - elapsed, 0);
		throw new RateLimitExceededError(Math.max(Math.ceil(remainingMs / 1000), 1));
	}
}

/**
 * Enforce a rule against the caller of `request`.
 *
 * @throws RateLimitExceededError when the budget is exhausted.
 */
export function enforceRateLimit(
	request: NextRequest,
	name: RateLimitName
): void {
	consumeRateLimit(rateLimitKey(request), name);
}

/**
 * `429` response, matching the `{ error }` envelope every other failure uses and
 * carrying the `Retry-After` header a client needs in order to back off.
 */
export function toRateLimitResponse(error: RateLimitExceededError): Response {
	const headers = new Headers({
		"Retry-After": String(error.retryAfterSeconds),
	});
	return jsonError(error.message, 429, undefined, headers);
}

/** Drop the oldest half of the table. Insertion order makes that the first half. */
function evictOldest(): void {
	let toDrop = Math.ceil(counters.size / 2);
	for (const key of counters.keys()) {
		if (toDrop-- <= 0) {
			break;
		}
		counters.delete(key);
	}
}

/** Clear every counter. Used between tests so budgets do not leak across cases. */
export function resetRateLimits(): void {
	counters.clear();
}

/**
 * Replace the rule budgets.
 *
 * @returns the previous budgets, so a test can restore them.
 */
export function setRateLimitRules(
	next: Record<string, RateLimitRule>
): Record<string, RateLimitRule> {
	const previous = rules;
	rules = { ...next };
	return previous;
}
