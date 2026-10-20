/** Auth/write budgets use atomic PostgreSQL counters in deployments. Public
 * reads use bounded process memory. All keys include the rule name. */

import type { NextRequest } from "next/server";
import { getAuthContext } from "./auth";
import { jsonError } from "./response";
import { createHash } from "node:crypto";

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
export async function consumeRateLimit(identity: string, name: RateLimitName): Promise<void> {
	const deployed = process.env.NODE_ENV === "production" || !!process.env.VERCEL || !!process.env.VERCEL_ENV;
	if (!deployed && process.env[DISABLE_FLAG] === "1") {
		return;
	}
	const rule = rules[name];
	if (rule === undefined) {
		return;
	}
	const key = `${name}:${identity}`;
	const sharedRules: RateLimitName[] = ["login", "register", "refresh", "profileWrite", "bookingWrite", "checkout"];
	if ((deployed || process.env.FLYNEXT_RATE_LIMIT_STORE === "database") && sharedRules.includes(name)) {
		const { prisma } = await import("../prisma");
		const hash = createHash("sha256").update(key).digest("hex");
		// Database clock and one atomic upsert coordinate all application workers.
		const rows = await prisma.$queryRaw<Array<{ count: number; remaining: number }>>`
			INSERT INTO "RateLimitCounter" ("key", "count", "expiresAt")
			VALUES (${hash}, 1, clock_timestamp() + ${rule.windowMs} * interval '1 millisecond')
			ON CONFLICT ("key") DO UPDATE SET
			 "count" = CASE WHEN "RateLimitCounter"."expiresAt" <= clock_timestamp() THEN 1 ELSE "RateLimitCounter"."count" + 1 END,
			 "expiresAt" = CASE WHEN "RateLimitCounter"."expiresAt" <= clock_timestamp() THEN clock_timestamp() + ${rule.windowMs} * interval '1 millisecond' ELSE "RateLimitCounter"."expiresAt" END
			RETURNING "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp()))))::int AS remaining`;
		if (rows[0].count > rule.max) throw new RateLimitExceededError(rows[0].remaining);
		// Expired keys contain no useful state. Bounded batches avoid a long cleanup lock.
		if (Math.random() < 0.01) await prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "key" IN (SELECT "key" FROM "RateLimitCounter" WHERE "expiresAt" < clock_timestamp() LIMIT 1000)`;
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
export async function enforceRateLimit(
	request: NextRequest,
	name: RateLimitName
): Promise<void> {
	// Credential operations must not let a caller change buckets with a bearer token.
	const identity = ["login", "register", "refresh"].includes(name) ? `ip:${getClientIp(request)}` : rateLimitKey(request);
	await consumeRateLimit(identity, name);
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
