/**
 * `POST /api/auth/login`
 *
 * Verifies credentials and issues an access token in the response body plus a
 * refresh token in an http-only cookie.
 *
 * Response contract, relied on by `app/auth/login/page.tsx`:
 * - `400 { error: "Email and password are required" }`
 * - `401 { error: "Account does not exist" }`
 * - `401 { error: "Invalid password" }`
 * - `429 { error: string }` — this is the most tightly rate-limited route on the
 *   API, charged per source address and per account
 * - `200 { message: "Login successful", accessToken: string }`
 *
 * The refresh cookie's `maxAge` is derived with `parseDurationToSeconds`, because
 * the configured lifetime is a `jsonwebtoken` duration string (`"12h"`, `"7d"`)
 * and cannot be assumed to be a number of days.
 */

import * as cookie from "cookie";
import { badRequest, unauthorized } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { consumeRateLimit, enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonWithSetCookie } from "@/lib/api/response";
import { parseJsonBody, readString } from "@/lib/api/validation";
import {
	comparePassword,
	generateAccessToken,
	generateRefreshToken,
	getRefreshTokenMaxAgeSeconds,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { LoginResponse } from "@/types";

export const POST = withRoute(async (request) => {
	// Cheap rejection first: a brute-force run should not reach the database at
	// all once its address has spent the budget.
	enforceRateLimit(request, "login");

	const body = await parseJsonBody(request);

	// One combined message for both fields: the login form renders it verbatim.
	const emailInput = readString(body, "email", { maxLength: 254 });
	const password = readString(body, "password", { maxLength: 200 });
	if (emailInput === undefined || password === undefined) {
		throw badRequest("Email and password are required");
	}

	const email = emailInput.toLowerCase();

	// A second budget scoped to the account, not the connection: spreading guesses
	// for one address across many source addresses would otherwise cost nothing.
	consumeRateLimit(`login:account:${email}`, "login");

	/*
	 * Look the account up case-insensitively, but try the exact match first:
	 * registration stores addresses in lower case, while seeded and manually
	 * inserted rows can still carry a mixed-case spelling.
	 */
	const user =
		(await prisma.user.findUnique({ where: { email } })) ??
		(await prisma.user.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
		}));

	if (user === null) {
		throw unauthorized("Account does not exist");
	}

	const isMatch = await comparePassword(password, user.password);
	if (!isMatch) {
		throw unauthorized("Invalid password");
	}

	const accessToken = generateAccessToken({ userId: user.id });
	const refreshToken = generateRefreshToken({ userId: user.id });

	const cookieHeader = cookie.serialize("refreshToken", refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		path: "/",
		maxAge: getRefreshTokenMaxAgeSeconds(),
	});

	const body_out: LoginResponse = {
		message: "Login successful",
		accessToken,
	};
	return jsonWithSetCookie(body_out, cookieHeader, 200);
});
