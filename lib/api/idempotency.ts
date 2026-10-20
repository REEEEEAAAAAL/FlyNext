import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ApiError, ProviderBookingRejected, badRequest, conflict } from "./errors";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "../prisma";

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
	}
	return JSON.stringify(value) ?? "null";
}

function identity(request: Request, userId: number, scope: string, body: unknown) {
	const key = request.headers.get("Idempotency-Key");
	if (key === null || !/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw badRequest("Idempotency-Key is required (8-128 letters, digits, colon, underscore or hyphen)");
	return { userId, key, scope, requestHash: createHash("sha256").update(canonical(body)).digest("hex") };
}

type Result = { body: unknown; status: number };
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function response(result: Result): Response { return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } }); }

export async function idempotentWrite(request: Request, userId: number, scope: string, body: unknown, work: (tx: Prisma.TransactionClient) => Promise<Result>): Promise<Response> {
	const input = identity(request, userId, scope, body);
	const result = await prisma.$transaction(async tx => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request:${userId}:${input.key}`}, 0))`;
		const stored = await tx.bookingRequest.findUnique({ where: { userId_key: { userId, key: input.key } } });
		if (stored) {
			if (stored.scope !== scope || stored.requestHash !== input.requestHash) throw conflict("Idempotency-Key was already used for a different request");
			if (stored.state !== "COMPLETE") throw conflict("Booking result is unresolved; retain this key and check your bookings before retrying");
			return { body: stored.response, status: stored.statusCode! };
		}
		const result = await work(tx);
		await tx.bookingRequest.create({ data: { ...input, key: input.key, response: json(result.body), statusCode: result.status, state: "COMPLETE" } });
		return result;
	}, DEFAULT_TRANSACTION_OPTIONS);
	return response(result);
}

// External calls run outside transactions. An unresolved call is never blindly repeated.
export async function idempotentExternal(request: Request, userId: number, scope: string, body: unknown, work: (operationId?: string) => Promise<Result>, recover?: (operationId: string) => Promise<Result | null>, recoveryData?: Prisma.InputJsonValue): Promise<Response> {
	const input = identity(request, userId, scope, body);
	const claim = await prisma.$transaction(async tx => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request:${userId}:${input.key}`}, 0))`;
		const stored = await tx.bookingRequest.findUnique({ where: { userId_key: { userId, key: input.key! } } });
		if (stored) {
			if (stored.scope !== scope || stored.requestHash !== input.requestHash) throw conflict("Idempotency-Key was already used for a different request");
			return { stored, fresh: false };
		}
		return { stored: await tx.bookingRequest.create({ data: { ...input, key: input.key!, recovery: recoveryData } }), fresh: true };
	}, DEFAULT_TRANSACTION_OPTIONS);
	if (!claim.fresh) {
		let stored = claim.stored;
		for (let attempt = 0; stored.state === "PENDING" && attempt < 8; attempt++) {
			await new Promise(resolve => setTimeout(resolve, 250));
			stored = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: stored.id } });
		}
		if (stored.state === "COMPLETE") return response({ body: stored.response, status: stored.statusCode! });
		if (stored.state === "PENDING" && recover) {
			const recovered = await recover(stored.id);
			if (recovered) return response(recovered);
		}
		throw conflict(`Booking result is pending or unresolved. Check your bookings; recovery reference: ${claim.stored.id}. Keep the same key.`);
	}
	let result: Result;
	try { result = await work(claim.stored.id); }
	catch (error) {
		if (!(error instanceof ApiError) || (error.status >= 500 && !(error instanceof ProviderBookingRejected) && !error.message.includes("ticket has been released"))) throw error;
		result = { status: error.status, body: { error: error.message } };
	}
	const committed = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: claim.stored.id } });
	if (committed.state === "COMPLETE") return response({ body: committed.response, status: committed.statusCode! });
	const saved = await prisma.bookingRequest.update({ where: { id: claim.stored.id }, data: { state: "COMPLETE", response: json(result.body), statusCode: result.status } });
	return response({ body: saved.response, status: saved.statusCode! });
}
