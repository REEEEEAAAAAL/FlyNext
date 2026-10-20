import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as cookie from "cookie";
import { getRefreshTokenMaxAgeSeconds } from "./auth";
import { prisma, DEFAULT_TRANSACTION_OPTIONS } from "./prisma";
import { forbidden } from "./api/errors";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(48).toString("base64url");
const validToken = (token: string) => /^[A-Za-z0-9_-]{64}$/.test(token);

export function refreshCookie(token: string, maxAge = getRefreshTokenMaxAgeSeconds()): string {
	return cookie.serialize("refreshToken", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge });
}
export async function createRefreshSession(userId: number): Promise<string> {
	const token = newToken();
	await prisma.refreshSession.create({ data: { tokenHash: digest(token), familyId: randomUUID(), userId,
		expiresAt: new Date(Date.now() + getRefreshTokenMaxAgeSeconds() * 1000) } });
	return token;
}

/** A family advisory lock serializes refresh, replay revocation, and logout across workers. */
export async function rotateRefreshSession(token: string): Promise<{ userId: number; token: string; expiresAt: Date }> {
	if (!validToken(token)) throw forbidden("Invalid or expired Refresh Token");
	const tokenHash = digest(token);
	const result = await prisma.$transaction(async tx => {
		const identity = await tx.refreshSession.findUnique({ where: { tokenHash }, select: { familyId: true } });
		if (!identity) return null;
		await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${identity.familyId}, 0))`;
		const session = await tx.refreshSession.findUnique({ where: { tokenHash }, include: { user: { select: { id: true } } } });
		if (!session) return null;
		if (session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user) {
			// Commit revocation before reporting failure; throwing here would roll it back.
			await tx.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
			return null;
		}
		await tx.refreshSession.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
		const replacement = newToken();
		await tx.refreshSession.create({ data: { tokenHash: digest(replacement), familyId: session.familyId,
			userId: session.userId, expiresAt: session.expiresAt } });
		return { userId: session.userId, token: replacement, expiresAt: session.expiresAt };
	}, DEFAULT_TRANSACTION_OPTIONS);
	if (!result) throw forbidden("Invalid or expired Refresh Token");
	return result;
}

export async function revokeRefreshSession(token: string): Promise<void> {
	if (!validToken(token)) return;
	const tokenHash = digest(token);
	await prisma.$transaction(async tx => {
		const identity = await tx.refreshSession.findUnique({ where: { tokenHash }, select: { familyId: true } });
		if (!identity) return;
		await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${identity.familyId}, 0))`;
		const session = await tx.refreshSession.findUnique({ where: { tokenHash } });
		if (session) await tx.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
	}, DEFAULT_TRANSACTION_OPTIONS);
}
