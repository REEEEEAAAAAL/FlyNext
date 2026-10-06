/**
 * Prisma client singleton.
 *
 * Next.js clears the module registry on every hot reload in development, so a
 * module-scope `new PrismaClient()` without caching would open a fresh connection
 * pool on each edit while the previous pools stayed alive. After a handful of
 * edits the database starts refusing connections with "too many clients already"
 * and every request fails.
 *
 * The same caching is what makes the serverless deployment correct, and there
 * it matters more rather than less:
 *
 * - A serverless host runs many short-lived worker processes. Every distinct
 *   module instance that evaluates this file would otherwise construct its own
 *   `PrismaClient`, and every client opens its own pool. Against a pooled endpoint
 *   (Neon's `-pooler` host, PgBouncer) that is how a traffic spike turns into
 *   "too many connections" and a wave of `500`s.
 * - Warm invocations reuse the module, so caching on `globalThis` — which the
 *   runtime preserves for the life of the worker, not just the life of the
 *   request — means one pool per worker instead of one per invocation.
 *
 * Because of that, the cache is kept in production too. Retaining one client on a
 * global is not a leak: there is exactly one entry, it is the same client the
 * module would have exported anyway, and the runtime reclaims it when the worker
 * is retired.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Budgets for every interactive transaction (`prisma.$transaction(async …)`).
 *
 * Prisma's defaults — a 5 s transaction and a 2 s wait for a pooled connection —
 * are sized for a database on the same host. This deployment's `DATABASE_URL`
 * points at a pooled serverless PostgreSQL (Neon), where one round trip can
 * measure hundreds of milliseconds and a cold connection takes seconds to
 * establish. Under those defaults a create request died mid-transaction with
 * `P2028` ("Transaction already closed"), and because the failing statement was
 * the last one in the transaction the client saw a bare `500` that a retry then
 * did not reproduce — the worst shape for an error to take, because the caller
 * cannot tell a request that did nothing from one that committed and merely
 * failed to report back.
 *
 * `timeout` bounds the statements; `maxWait` bounds the queue for a connection.
 * Both are ceilings on a stuck transaction rather than the expected duration —
 * every transaction in this codebase is a handful of primary-key writes that
 * commits in well under a second on a warm connection. Raising `timeout` to match
 * a cold start is safe because a transaction that overruns still rolls back
 * atomically; raising `maxWait` is what stops a request from being rejected while
 * it is merely waiting behind other transactions in the same worker.
 *
 * Spread this into the second argument of every interactive transaction so the
 * numbers are stated once:
 *
 * ```ts
 * await prisma.$transaction(async (tx) => { … }, DEFAULT_TRANSACTION_OPTIONS);
 * ```
 *
 * It is deliberately not a `PrismaClient` constructor option: Prisma has no
 * global transaction budget, and this keeps the value greppable at each call
 * site. Read-only batch transactions (`$transaction([...])`) do not hold a
 * connection open and need no budget.
 */
export const DEFAULT_TRANSACTION_OPTIONS = {
	timeout: 20_000,
	maxWait: 5_000,
} as const;

/**
 * `globalThis` is not declared with our key, and TypeScript has no way to know
 * about the property Next.js's module reloader preserves. This is the standard,
 * documented boundary for the Prisma + Next.js singleton pattern; the cast is
 * confined to this one declaration and does not widen any other type.
 */
const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

/**
 * `createPrismaClient` is deliberately not given an explicit `datasources` URL.
 * Prisma already takes `DATABASE_URL` from the environment, and passing it
 * explicitly would evaluate it at module scope — which happens during
 * `next build` while collecting route metadata, before the deployment's
 * environment is necessarily complete. Keeping the read inside Prisma means an
 * absent URL surfaces when a query actually runs, not as a build failure.
 */
function createPrismaClient(): PrismaClient {
	return new PrismaClient({
		// Errors are the one class of message worth keeping in a serverless log,
		// where there is no attached terminal to watch: query and info logging would
		// be billed and discarded. Prisma reports connection and query failures this
		// way, and `lib/api/handler.ts` reads `error.code` off the thrown instance.
		log: ["error"],
	});
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
