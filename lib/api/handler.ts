/**
 * The single error boundary every API route runs inside.
 *
 * `withRoute` exists so that a handler never has to shape a failure response, and
 * so that three things hold for every route without each one restating them:
 *
 * - A thrown value always becomes JSON. The browser client calls `res.json()`
 *   on every response, so a rejected promise escaping as an HTML error page makes
 *   the page throw instead of showing an error.
 * - Nothing internal reaches the caller. Prisma and driver messages are
 *   logged server-side; the response carries a stable sentence.
 * - A status means the same thing everywhere. The same condition cannot be a
 *   `500` in one route and a `400` in another.
 */

import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { ApiError, toErrorMessage } from "./errors";
import { RateLimitExceededError, toRateLimitResponse } from "./rate-limit";
import { jsonError } from "./response";
import type { RouteContext, RouteParams } from "@/types";

/** Signature Next.js invokes for an App Router HTTP method. */
export type RouteHandler<TParams extends RouteParams = RouteParams> = (
	request: NextRequest,
	context: RouteContext<TParams>
) => Promise<Response>;

/**
 * Map an unknown thrown value onto the API's JSON error envelope.
 *
 * Prisma's `P2025` ("record required but not found") is translated to `404`
 * because `update`/`delete` on a missing row is a client-visible condition, not
 * a server fault.
 */
export function toErrorResponse(error: unknown): Response {
	if (error instanceof ApiError) {
		return jsonError(error.message, error.status, error.details, error.headers);
	}

	// A spent rate-limit budget is a normal outcome, not a fault: it is rendered
	// here so that a handler only has to call `enforceRateLimit` and the
	// `Retry-After` header is attached in exactly one place.
	if (error instanceof RateLimitExceededError) {
		return toRateLimitResponse(error);
	}

	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		switch (error.code) {
			case "P2025":
				return jsonError("Resource not found", 404);
			case "P2002":
				return jsonError("Resource already exists", 409);
			case "P2003":
			case "P2014":
				return jsonError("Referenced resource does not exist", 400);
			case "P2000":
				return jsonError("A provided value is too long", 400);
			default:
				break;
		}
		// Log the full detail; return nothing internal to the caller.
		console.error(`[api] prisma error ${error.code}:`, error);
		return jsonError("Database request failed", 500);
	}

	if (error instanceof Prisma.PrismaClientValidationError) {
		// Raised for malformed arguments — a wrong type, an unknown field, a
		// missing required one. Reaching Prisma with a shape it rejects means the
		// request carried something the validation layer did not anticipate, which
		// is a client problem (`400`), not an outage. The full message is still
		// logged, because a validation error the validation layer missed is the
		// class of defect this log is most worth reading for.
		console.error("[api] prisma validation error:", error);
		return jsonError("Invalid request", 400);
	}

	console.error("[api] unhandled error:", error);
	return jsonError("Internal Server Error", 500);
}

/**
 * Wrap a route handler so that every thrown value becomes a JSON response.
 *
 * The wrapped function keeps the exact signature Next.js expects, including the
 * `{ params: Promise<…> }` second argument.
 */
export function withRoute<TParams extends RouteParams = RouteParams>(
	handler: RouteHandler<TParams>
): RouteHandler<TParams> {
	return async (request, context) => {
		try {
			return await handler(request, context);
		} catch (error) {
			if (error instanceof ApiError || error instanceof RateLimitExceededError) {
				// Expected, caller-caused failures stay quiet in the log.
				return toErrorResponse(error);
			}
			console.error(
				`[api] ${request.method} ${new URL(request.url).pathname} failed:`,
				toErrorMessage(error)
			);
			return toErrorResponse(error);
		}
	};
}
