import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { generateRefreshToken } from "@/lib/auth";
import { revokeRefreshSession, rotateRefreshSession } from "@/lib/refresh-sessions";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { createUser, TEST_PASSWORD } from "#support/factories";
import { callRoute } from "#support/requests";

beforeEach(resetDatabase);
afterAll(disconnect);
function tokenOf(response: Response): string {
	return response.headers.get("set-cookie")!.match(/refreshToken=([^;]+)/)![1];
}
async function signIn() {
	const user = await createUser();
	const response = await callRoute(login, { method: "POST", json: { email: user.email, password: TEST_PASSWORD } });
	expect(response.status).toBe(200);
	expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
	expect(response.headers.get("set-cookie")).toMatch(/SameSite=Strict/);
	return { user, token: tokenOf(response) };
}
const exchange = (token: string) => callRoute(refresh, { method: "POST", headers: { cookie: `refreshToken=${token}` } });

describe("B07 durable refresh session lifecycle", () => {
	it("persists only a digest, rotates, and revokes the family after replay", async () => {
		const { user, token } = await signIn();
		const rows = await prisma.refreshSession.findMany({ where: { userId: user.id } });
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
		expect(JSON.stringify(rows)).not.toContain(token);
		const response = await exchange(token);
		expect(response.status).toBe(200);
		const replacement = tokenOf(response);
		expect(replacement).not.toBe(token);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect((await exchange(token)).status).toBe(403);
		expect((await exchange(replacement)).status).toBe(403);
	});
	it("logout revokes rotated sessions, including with an earlier family token", async () => {
		const { token } = await signIn();
		const replacement = tokenOf(await exchange(token));
		const response = await callRoute(logout, { method: "POST", headers: { cookie: `refreshToken=${token}` } });
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect((await exchange(replacement)).status).toBe(403);
		expect((await callRoute(logout, { method: "POST" })).status).toBe(200);
	});
	it("rejects expired sessions, deleted users, legacy JWTs and absent credentials", async () => {
		const { user, token } = await signIn();
		await prisma.refreshSession.updateMany({ data: { expiresAt: new Date(0) } });
		expect((await exchange(token)).status).toBe(403);
		expect((await exchange(generateRefreshToken({ userId: user.id }))).status).toBe(403);
		await prisma.user.delete({ where: { id: user.id } });
		expect((await exchange(token)).status).toBe(403);
		expect((await callRoute(refresh, { method: "POST" })).status).toBe(401);
	});
	it("serializes simultaneous rotation/replay and leaves no usable descendant", async () => {
		const { token } = await signIn();
		const responses = await Promise.all([exchange(token), exchange(token)]);
		expect(responses.map(row => row.status).sort()).toEqual([200, 403]);
		expect((await exchange(tokenOf(responses.find(row => row.status === 200)!))).status).toBe(403);
	});
	it("serializes logout against rotation of a newer member of the same family", async () => {
		const { token } = await signIn();
		const replacement = tokenOf(await exchange(token));
		await Promise.allSettled([rotateRefreshSession(replacement), revokeRefreshSession(token)]);
		expect(await prisma.refreshSession.count({ where: { revokedAt: null } })).toBe(0);
	});
});
