/**
 * Authentication and authorisation types.
 *
 * FlyNext issues two JWTs on login:
 *
 * - an access token returned in the JSON body and replayed by the browser in
 *   the `Authorization: Bearer <token>` header;
 * - a refresh token stored in an `httpOnly` cookie and exchanged at
 *   `POST /api/auth/refresh` for a fresh access token.
 *
 * Both carry the same claim set, so a single payload type is used for both.
 */

/**
 * Claims embedded in the access and refresh tokens.
 *
 * `userId` is what this codebase mints. `id` is accepted as an alias so that a
 * token minted by an older build of the service still authenticates; the verifier
 * normalises it to `userId` before anything else sees it.
 */
export interface TokenClaims {
	userId: number;
	/** Alias for {@link TokenClaims.userId}. Normalised away by the verifier. */
	id?: number;
	/** Issued-at, seconds since the epoch. Populated by `jsonwebtoken`. */
	iat?: number;
	/** Expiry, seconds since the epoch. Populated by `jsonwebtoken`. */
	exp?: number;
}

/**
 * The authenticated caller, as resolved from a verified access token.
 *
 * This deliberately contains only what the token proves. Handlers that need
 * more of the user record (for example `lastName`, required by the AFS
 * cancellation API) must load it from the database themselves.
 */
export interface AuthContext {
	/** Primary key of the authenticated user (`User.id`). */
	userId: number;
}

/** Outcome of verifying the `Authorization` header. */
export type AuthResult = AuthContext | null;

/** The `Set-Cookie` payload values used for the refresh token. */
export interface RefreshCookieOptions {
	httpOnly: true;
	secure: boolean;
	sameSite: "strict";
	path: "/";
	maxAge: number;
}
