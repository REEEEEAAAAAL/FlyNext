/** Revoke the refresh session family before clearing its HttpOnly cookie.
 * Missing/invalid cookies still return 200; a storage failure is reported. */

import * as cookie from "cookie";
import { withRoute } from "@/lib/api/handler";
import { jsonMessage } from "@/lib/api/response";
import { revokeRefreshSession } from "@/lib/refresh-sessions";
import { enforceRateLimit } from "@/lib/api/rate-limit";

export const POST = withRoute(async (request) => {
	await enforceRateLimit(request, "refresh");
	const token = cookie.parse(request.headers.get("cookie") ?? "").refreshToken;
	if (token) await revokeRefreshSession(token);
	const cookieHeader = cookie.serialize("refreshToken", "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		path: "/",
		maxAge: 0,
	});

	const response = jsonMessage("Logout successful", 200);
	response.headers.append("Set-Cookie", cookieHeader);
	return response;
});
