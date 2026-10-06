/**
 * `POST /api/auth/refresh`
 *
 * Exchanges the http-only `refreshToken` cookie for a new access token.
 *
 * Response contract, relied on by `app/auth/refresh/page.tsx`:
 * - `401` when no refresh cookie is present (body is not read by the client)
 * - `403 { error: "Invalid or expired Refresh Token" }`
 * - `429 { error: string }`
 * - `200 { accessToken: string }`
 *
 * The cookie is read with `cookie.parse`, which handles values containing `=` and
 * picks the right entry when other cookies share a name prefix, and the token is
 * verified before it is trusted.
 */

import * as cookie from "cookie";
import { forbidden, unauthorized } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { generateAccessToken, verifyRefreshToken } from "@/lib/auth";
import type { RefreshResponse } from "@/types";

export const POST = withRoute(async (request) => {
	enforceRateLimit(request, "refresh");

	const header = request.headers.get("cookie");
	if (header === null || header.length === 0) {
		throw unauthorized("No refresh token provided");
	}

	const refreshToken = cookie.parse(header).refreshToken;
	if (refreshToken === undefined || refreshToken.length === 0) {
		throw unauthorized("No refresh token provided");
	}

	const claims = verifyRefreshToken(refreshToken);
	if (claims === null) {
		throw forbidden("Invalid or expired Refresh Token");
	}

	const body: RefreshResponse = {
		accessToken: generateAccessToken({ userId: claims.userId }),
	};
	return jsonOk(body);
});
