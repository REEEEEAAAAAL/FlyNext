/**
 * Request-level authentication.
 *
 * This is the Next.js App Router equivalent of the `req.user` middleware
 * pattern: instead of mutating the framework request object (which Next.js
 * freezes and does not type as extensible), handlers call {@link requireAuth}
 * and receive a fully typed {@link AuthContext}.
 *
 * The `Authorization` header is treated as untrusted input:
 *
 * - a missing or empty header resolves to "anonymous", never an exception;
 * - an empty bearer value (`"Bearer "`) is anonymous, matching the browser
 *   client, which sends `Authorization: ""` on several pages while logged out;
 * - a malformed or expired token is anonymous rather than a thrown error.
 *
 * `requireAuth` is the only function that turns "anonymous" into a failure, so
 * public endpoints simply skip it.
 */

import { verifyAccessToken } from "../auth";
import { unauthorized } from "./errors";
import type { AuthContext } from "@/types";

/** A value accepted by the header helpers below. */
type RequestLike = { headers: Headers };

/**
 * Resolve the caller from the `Authorization` header.
 *
 * @returns the authenticated context, or `null` when no usable token is present.
 */
export function getAuthContext(request: RequestLike): AuthContext | null {
	const header = request.headers.get("authorization");
	if (!header) {
		return null;
	}

	const separator = header.indexOf(" ");
	if (separator === -1) {
		return null;
	}
	const scheme = header.slice(0, separator);
	const token = header.slice(separator + 1).trim();
	if (scheme.toLowerCase() !== "bearer" || token.length === 0) {
		return null;
	}

	const claims = verifyAccessToken(token);
	if (claims === null) {
		return null;
	}
	return { userId: claims.userId };
}

/**
 * Resolve the caller, or fail with `401 Unauthorized`.
 *
 * @throws ApiError status `401` — rendered as `{ error: "Unauthorized" }`.
 */
export function requireAuth(request: RequestLike): AuthContext {
	const context = getAuthContext(request);
	if (context === null) {
		throw unauthorized();
	}
	return context;
}
