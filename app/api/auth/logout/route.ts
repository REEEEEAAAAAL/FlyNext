/**
 * `POST /api/auth/logout`
 *
 * Clears the http-only refresh cookie.
 *
 * Response contract, relied on by `app/auth/logout/page.tsx`,
 * `app/components/NavigationBar.tsx` and `app/page.tsx`:
 * - always `200 { message: "Logout successful" }`
 *
 * The client calls `await res.json()` before testing `res.ok`, so this route
 * must never answer with a non-JSON body — a 5xx HTML error page would throw
 * inside the page's `try` block and leave the UI stuck on "Logging out…" with the
 * access token still in `localStorage`. It must also stay reachable with an empty
 * `Authorization` header, which three call sites send while logged out.
 *
 * The handler is intentionally synchronous in effect: it touches no database and
 * cannot fail, so the shared boundary exists only to normalise any unexpected
 * `cookie.serialize` failure into JSON.
 */

import * as cookie from "cookie";
import { withRoute } from "@/lib/api/handler";
import { jsonMessage } from "@/lib/api/response";

export const POST = withRoute(async () => {
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
