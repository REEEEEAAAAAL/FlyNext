"use client";

/**
 * The access token in `localStorage`, and the change notification for it.
 *
 * The token is stored under its own key — every page reads it directly — but a
 * component that has to react to a new token cannot discover one by
 * reading it. `localStorage` fires a `storage` event only in the other tabs,
 * so a token acquired by `/auth/login` or `/auth/refresh` in this tab is
 * invisible to anything already mounted.
 *
 * That gap is what would leave the notification badge frozen: it stops polling on
 * a `401` (correctly — there is nothing to count without a session) and has no way
 * to learn that a session has come back, short of a full page reload. Writing the
 * token through {@link setAccessToken} publishes {@link ACCESS_TOKEN_EVENT} so
 * the badge, and anything else that needs it, can resume.
 */

/** The `localStorage` key holding the JWT. */
export const ACCESS_TOKEN_KEY = "accessToken";

/** Fired on `window` whenever the access token is replaced or cleared. */
export const ACCESS_TOKEN_EVENT = "flynext:access-token";

/** Notify listeners that the token changed. */
function announce(): void {
	window.dispatchEvent(new Event(ACCESS_TOKEN_EVENT));
}

/** The current access token, or `null` when there is no session. */
export function getAccessToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/** Store a freshly issued access token and notify listeners. */
export function setAccessToken(token: string): void {
	localStorage.setItem(ACCESS_TOKEN_KEY, token);
	announce();
}

/** Drop the access token and notify listeners. */
export function clearAccessToken(): void {
	localStorage.removeItem(ACCESS_TOKEN_KEY);
	announce();
}

/**
 * Subscribe to token changes.
 *
 * The `storage` event is included so a sign-in in another tab also resumes this
 * one.
 *
 * @returns an unsubscribe function.
 */
export function subscribeToAccessToken(listener: () => void): () => void {
	window.addEventListener(ACCESS_TOKEN_EVENT, listener);
	window.addEventListener("storage", listener);
	return () => {
		window.removeEventListener(ACCESS_TOKEN_EVENT, listener);
		window.removeEventListener("storage", listener);
	};
}
