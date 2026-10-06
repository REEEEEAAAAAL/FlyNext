/**
 * Password hashing and JWT minting/verification.
 *
 * This module is deliberately framework-agnostic: it never touches a `Request`.
 * Resolving a request's `Authorization` header into an identity lives in
 * `lib/api/auth.ts`.
 */

import bcrypt from "bcryptjs";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { TokenClaims } from "@/types";

/** bcrypt cost factor. */
const BCRYPT_ROUNDS = 10;

/**
 * Read a required environment variable.
 *
 * Reading configuration lazily (rather than at module scope) means a missing
 * value produces a precise error at the point of use instead of turning every
 * token into `"undefined"`. Signing with an undefined secret fails deep inside
 * `jsonwebtoken` with an opaque "secretOrPrivateKey must have a value"; the
 * explicit check below is what turns that into an actionable message naming the
 * variable that has to be set.
 */
function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim().length === 0) {
		throw new Error(
			`Missing required environment variable "${name}". ` +
				"Copy .env.example to .env and fill it in."
		);
	}
	return value;
}

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

/** Hash a plaintext password for storage in `User.password`. */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Constant-time comparison of a plaintext password against a stored hash. */
export async function comparePassword(
	password: string,
	hash: string
): Promise<boolean> {
	return bcrypt.compare(password, hash);
}

/* -------------------------------------------------------------------------- */
/* Token lifetimes                                                            */
/* -------------------------------------------------------------------------- */

const DURATION_PATTERN = /^(\d+)([smhd])?$/;

/**
 * Convert a jsonwebtoken-style duration (`"1h"`, `"7d"`, `"3600"`) to seconds.
 *
 * `jsonwebtoken` accepts these strings for `expiresIn` but exposes no parser, so
 * the cookie `maxAge` has to be derived separately. `parseInt` alone cannot do it:
 * the unit suffix is part of the value, and a bare `parseInt("7d")` silently reads
 * seven days as seven seconds while `parseInt("12h")` reads twelve hours as twelve
 * days. Parsing the unit explicitly keeps the cookie lifetime and the token
 * lifetime in agreement, and an unset variable becomes a named error rather than
 * `NaN` (which the cookie layer would turn into a session cookie that never
 * expires).
 */
export function parseDurationToSeconds(value: string, field: string): number {
	const match = DURATION_PATTERN.exec(value.trim());
	if (match === null) {
		throw new Error(
			`Environment variable "${field}" must be a duration such as "15m", "1h" or "7d" (got "${value}").`
		);
	}
	const amount = Number(match[1]);
	// A bare number is seconds, matching `jsonwebtoken`'s own convention.
	const unit = match[2] ?? "s";
	const multipliers: Record<string, number> = {
		s: 1,
		m: 60,
		h: 60 * 60,
		d: 24 * 60 * 60,
	};
	const multiplier = multipliers[unit];
	if (multiplier === undefined) {
		throw new Error(`Unsupported duration unit "${unit}" in "${field}".`);
	}
	return amount * multiplier;
}

/** Lifetime of the refresh cookie, in seconds. */
export function getRefreshTokenMaxAgeSeconds(): number {
	return parseDurationToSeconds(
		requireEnv("JWT_REFRESH_TOKEN_EXPIRY_TIME"),
		"JWT_REFRESH_TOKEN_EXPIRY_TIME"
	);
}

/* -------------------------------------------------------------------------- */
/* Token minting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `@types/jsonwebtoken` types `expiresIn` as `number | StringValue`, where
 * `StringValue` is a template-literal union of every duration `ms` understands.
 * Our value comes from an environment variable, so it can only be a plain
 * `string`. The cast is the unavoidable boundary and `parseDurationToSeconds`
 * validates the same value before it is used for the cookie.
 */
function expiryOption(envName: string): SignOptions["expiresIn"] {
	const value = requireEnv(envName);
	parseDurationToSeconds(value, envName);
	return value as SignOptions["expiresIn"];
}

/** Sign a short-lived access token returned in the login/refresh body. */
export function generateAccessToken(payload: TokenClaims): string {
	return jwt.sign({ userId: payload.userId }, requireEnv("JWT_ACCESS_SECRET"), {
		expiresIn: expiryOption("JWT_ACCESS_TOKEN_EXPIRY_TIME"),
	});
}

/** Sign a long-lived refresh token stored in an http-only cookie. */
export function generateRefreshToken(payload: TokenClaims): string {
	return jwt.sign({ userId: payload.userId }, requireEnv("JWT_REFRESH_SECRET"), {
		expiresIn: expiryOption("JWT_REFRESH_TOKEN_EXPIRY_TIME"),
	});
}

/* -------------------------------------------------------------------------- */
/* Token verification                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Narrow a verified JWT to our claim set.
 *
 * `jwt.verify` returns `string | JwtPayload`, and the payload is attacker
 * controlled until proven otherwise, so the claim is validated rather than cast.
 */
function toClaims(decoded: string | JwtPayload): TokenClaims | null {
	if (typeof decoded === "string") {
		return null;
	}
	const candidate = decoded.userId ?? decoded.id;
	if (typeof candidate === "number" && Number.isInteger(candidate)) {
		return { userId: candidate, iat: decoded.iat, exp: decoded.exp };
	}
	// Some deployments serialise the subject as a numeric string.
	if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
		return { userId: Number(candidate), iat: decoded.iat, exp: decoded.exp };
	}
	return null;
}

/** Verify an access token. Returns `null` for any invalid or expired token. */
export function verifyAccessToken(token: string): TokenClaims | null {
	try {
		return toClaims(jwt.verify(token, requireEnv("JWT_ACCESS_SECRET")));
	} catch {
		// Expired, tampered with, wrong secret, or missing configuration: all
		// mean "not authenticated" to the caller.
		return null;
	}
}

/** Verify a refresh token. Returns `null` for any invalid or expired token. */
export function verifyRefreshToken(token: string): TokenClaims | null {
	try {
		return toClaims(jwt.verify(token, requireEnv("JWT_REFRESH_SECRET")));
	} catch {
		return null;
	}
}
