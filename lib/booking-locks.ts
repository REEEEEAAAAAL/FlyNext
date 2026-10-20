import type { Prisma } from "@prisma/client";

export async function lockTraveller(tx: Prisma.TransactionClient, userId: number): Promise<void> {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(41004, ${userId}::int)`;
}

export async function lockRoom(tx: Prisma.TransactionClient, roomTypeId: number): Promise<void> {
	await tx.$queryRaw`SELECT id FROM "RoomType" WHERE id = ${roomTypeId} FOR UPDATE`;
}

export function money(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
		throw new Error("Invalid monetary value");
	}
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
