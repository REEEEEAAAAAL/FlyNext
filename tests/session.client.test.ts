import { afterEach, beforeEach, expect, it, vi } from "vitest";

const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
const freshToken = () => token(Math.floor(Date.now() / 1000) + 3600);
beforeEach(() => {
	vi.resetModules();
	const target = new EventTarget();
	vi.stubGlobal("window", Object.assign(target, { location: { origin: "http://localhost:3000" } }));
	vi.stubGlobal("localStorage", { removeItem: vi.fn(), setItem: vi.fn() });
	vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());

it("keeps access tokens in memory and shares one concurrent refresh", async () => {
	const value = freshToken();
	const fetch = vi.fn(async () => Response.json({ accessToken: value }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	const values = await Promise.all([session.recoverSession(), session.recoverSession()]);
	expect(values).toEqual([value, value]);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(session.getAccessToken()).toBe(value);
	expect(localStorage.setItem).not.toHaveBeenCalled();
});
it("retries a GET once after session recovery", async () => {
	const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
		.mockResolvedValueOnce(Response.json({ accessToken: freshToken() }))
		.mockResolvedValueOnce(Response.json({ ok: true }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	session.setAccessToken(freshToken());
	expect((await session.sessionFetch("/api/user")).status).toBe(200);
	expect(fetch).toHaveBeenCalledTimes(3);
});
it("never retries a write after a 401 or network failure", async () => {
	const fetch = vi.fn(async () => new Response(null, { status: 401 }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	session.setAccessToken(freshToken());
	expect((await session.sessionFetch("/api/itineraries", { method: "POST" })).status).toBe(401);
	expect(fetch).toHaveBeenCalledTimes(1);
	fetch.mockRejectedValueOnce(new Error("offline"));
	await expect(session.sessionFetch("/api/itineraries", { method: "POST" })).rejects.toThrow("offline");
	expect(fetch).toHaveBeenCalledTimes(2);
});
it("refreshes an expired token before sending a single write", async () => {
	const value = freshToken();
	const fetch = vi.fn().mockResolvedValueOnce(Response.json({ accessToken: value })).mockResolvedValueOnce(Response.json({ ok: true }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	session.setAccessToken(token(1));
	await session.sessionFetch("/api/hotels/book", { method: "POST", headers: { Authorization: "Bearer stale" } });
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(fetch.mock.calls[1][1].headers.get("Authorization")).toBe(`Bearer ${value}`);
});
it("does not restore a credential after logout races an in-flight refresh", async () => {
	let finish!: (response: Response) => void;
	vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
	const session = await import("@/app/lib/session");
	const pending = session.recoverSession();
	session.logoutLocally();
	finish(Response.json({ accessToken: freshToken() }));
	await pending;
	expect(session.getAccessToken()).toBeNull();
	expect(await session.recoverSession()).toBeNull();
});
it("does not attach credentials to another origin", async () => {
	const fetch = vi.fn(async () => Response.json({ ok: true }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	session.setAccessToken(freshToken());
	await session.sessionFetch("https://example.com/api/example");
	expect(fetch.mock.calls[0]).toEqual(["https://example.com/api/example", {}]);
});
it.each(["login", "logout"])("serializes %s behind an in-flight refresh cookie response", async action => {
	let finish!: (response: Response) => void;
	const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
		.mockResolvedValueOnce(Response.json({ ok: true }));
	vi.stubGlobal("fetch", fetch);
	const session = await import("@/app/lib/session");
	const refreshing = session.recoverSession();
	if (action === "logout") session.logoutLocally();
	const transition = session.sessionFetch(`/api/auth/${action}`, { method: "POST" });
	expect(fetch).toHaveBeenCalledTimes(1);
	finish(Response.json({ accessToken: freshToken() }));
	await refreshing;
	await transition;
	expect(fetch.mock.calls.map(row => row[0])).toEqual(["/api/auth/refresh", `/api/auth/${action}`]);
});
