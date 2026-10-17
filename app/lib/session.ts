"use client";

/** Access credentials live only in memory; the refresh cookie is HttpOnly. */
export const ACCESS_TOKEN_EVENT = "flynext:access-token";
let accessToken: string | null = null;
let refreshRequest: Promise<string | null> | null = null;
let generation = 0;
let loggedOut = false;
function announce() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ACCESS_TOKEN_EVENT));
}
export function getAccessToken(): string | null { return accessToken; }
export function setAccessToken(token: string): void {
    accessToken = token; loggedOut = false; generation++;
    try { localStorage.removeItem("accessToken"); } catch { /* storage may be disabled */ }
    announce();
}
export function clearAccessToken(): void {
    accessToken = null; generation++;
    try { localStorage.removeItem("accessToken"); } catch { /* storage may be disabled */ }
    announce();
}
export function logoutLocally(): void { loggedOut = true; clearAccessToken(); }
export function subscribeToAccessToken(listener: () => void): () => void {
    window.addEventListener(ACCESS_TOKEN_EVENT, listener);
    return () => window.removeEventListener(ACCESS_TOKEN_EVENT, listener);
}
function fresh(token: string | null): boolean {
    if (!token) return false;
    try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 15_000;
    } catch { return false; }
}
export async function recoverSession(force = false): Promise<string | null> {
    if (!force && fresh(accessToken)) return accessToken;
    if (loggedOut) return null;
    if (refreshRequest) return refreshRequest;
    const started = generation;
    const exchange = async () => {
        const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", cache: "no-store" });
        const body = await response.json();
        if (started !== generation) return accessToken;
        if (!response.ok || typeof body.accessToken !== "string") {
            if (response.status === 401 || response.status === 403) logoutLocally();
            return null;
        }
        setAccessToken(body.accessToken);
        return body.accessToken as string;
    };
    refreshRequest = (typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("flynext-refresh", exchange) : exchange())
        .catch(() => null).finally(() => { refreshRequest = null; });
    return refreshRequest;
}
/** Refresh before a write when needed. Only GET may be retried after a 401. */
export async function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin && /^\/api\/auth\/(login|logout)$/.test(url.pathname)) {
        // Serialize every refresh-cookie writer. A late refresh response must
        // not replace a newer login cookie or restore a cookie after logout.
        if (refreshRequest) await refreshRequest;
        const send = () => fetch(input, init);
        return typeof navigator !== "undefined" && navigator.locks
            ? navigator.locks.request("flynext-refresh", send) : send();
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) return fetch(input, init);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let token = getAccessToken();
    if (token && !fresh(token)) token = await recoverSession();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");
    const response = await fetch(input, { ...init, headers });
    if (response.status !== 401 || method !== "GET") return response;
    const current = getAccessToken();
    const replacement = current !== token && fresh(current) ? current : await recoverSession(true);
    if (!replacement) return response;
    headers.set("Authorization", `Bearer ${replacement}`);
    return fetch(input, { ...init, headers });
}
