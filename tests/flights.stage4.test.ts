import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFlights, createBooking, cancelFlight } from "@/lib/afs-client";
import * as ledger from "@/lib/afs/ledger";
import { cancelFlightReservation, createFlightReservation } from "@/lib/reservations";
import { POST as bookRoute } from "@/app/api/flights/book/route";
import { GET as flightVerify } from "@/app/api/itineraries/[itineraryId]/flights/route";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { createUser, createItinerary } from "#support/factories";
import { buildRequest, callRoute, readJson, tokenFor } from "#support/requests";
import { prisma as applicationDb } from "@/lib/prisma";
import { idempotentExternal } from "@/lib/api/idempotency";
import { reconcileFlightRequest } from "@/lib/afs-recovery";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(disconnect);
const passenger = { firstName: "Demo", lastName: "Traveller", email: "demo@example.com", passportNumber: "DEMO-IDENTIFIER" };
async function flight() {
	const date = new Date(); date.setUTCDate(date.getUTCDate() + 14);
	const groups = await searchFlights({ origin: "YYZ", destination: "LHR", date: date.toISOString().slice(0, 10) });
	return groups.find(group => group.flights.length === 1)!.flights[0]!;
}

describe("stage 4 durable flight booking", () => {
	it("recovers after the durable claim before any provider call without requiring the browser to retry", async () => {
		const user = await createUser();
		const leg = await flight();
		const payload = { ...passenger, flightIds: [leg.id] };
		const request = buildRequest({ method: "POST", headers: { "Idempotency-Key": "durable-before-provider" } });
		await expect(idempotentExternal(request, user.id, "flight-book", payload, async () => { throw new Error("Interrupted before provider"); }, undefined, { payload, returnLegCount: 0 })).rejects.toThrow("Interrupted");
		const stored = await prisma.bookingRequest.findFirstOrThrow();
		await reconcileFlightRequest(stored.id);
		await reconcileFlightRequest(stored.id);
		expect(await prisma.bookingRequest.findUniqueOrThrow({ where: { id: stored.id } })).toMatchObject({ state: "COMPLETE", statusCode: 201 });
		expect(await prisma.afsOfflineBooking.count()).toBe(1);
		expect(await prisma.flightReservation.count()).toBe(1);
	}, 60000);
	it("has one winner for the final seat across simultaneous requests", async () => {
		const leg = await flight();
		const capacity = leg.availableSeats;
		await prisma.afsOfflineBooking.createMany({ data: Array.from({ length: leg.availableSeats - 1 }, (_, i) => ({ id: `filled-${i}`, ...passenger, flightIds: [leg.id] })) });
		const results = await Promise.allSettled([0, 1].map(() => createBooking({ ...passenger, flightIds: [leg.id] })));
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(await prisma.afsOfflineBooking.count({ where: { status: "CONFIRMED" } })).toBe(capacity);
	}, 60_000);

	it("rolls back every leg when a later leg is full and handles reversed lock order", async () => {
		await ledger.claimSeatsAndWrite({ id: "full", ...passenger, flightIds: ["B"], status: "CONFIRMED", createdAt: new Date() }, new Map([["B", 1]]));
		await expect(ledger.claimSeatsAndWrite({ id: "blocked", ...passenger, flightIds: ["A", "B"], status: "CONFIRMED", createdAt: new Date() }, new Map([["A", 1], ["B", 1]]))).rejects.toMatchObject({ status: 400 });
		expect(await prisma.afsOfflineBooking.count()).toBe(1);
		await ledger.setStatus("full", "CANCELLED");
		const results = await Promise.allSettled([new Map([["A", 1], ["B", 1]]), new Map([["B", 1], ["A", 1]])].map((capacities, i) => ledger.claimSeatsAndWrite({ id: `race-${i}`, ...passenger, flightIds: [...capacities.keys()], status: "CONFIRMED", createdAt: new Date() }, capacities)));
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
	}, 60_000);

	it("does not report cancellation success when the ledger write fails; retry releases once", async () => {
		const leg = await flight();
		const booked = await createBooking({ ...passenger, flightIds: [leg.id] });
		vi.spyOn(ledger, "setStatus").mockResolvedValueOnce(false);
		await expect(cancelFlight(booked.id!, passenger.lastName)).rejects.toMatchObject({ status: 502 });
		expect((await prisma.afsOfflineBooking.findUniqueOrThrow({ where: { id: booked.id! } })).status).toBe("CONFIRMED");
		expect((await cancelFlight(booked.id!, passenger.lastName)).status).toBe("CANCELLED");
		expect((await cancelFlight(booked.id!, passenger.lastName)).status).toBe("CANCELLED");
	}, 60_000);

	it("replays a committed response, ignores legacy passport input, and uses the ticketed surname after profile edits", async () => {
		const user = await createUser({ lastName: passenger.lastName });
		const leg = await flight();
		const body = { ...passenger, passportNumber: "legacy-sensitive-input", flightIds: [leg.id] };
		const options = { method: "POST" as const, token: tokenFor(user.id), json: body, headers: { "Idempotency-Key": "flight-lost-response" } };
		const first = await callRoute(bookRoute, options);
		expect(first.status).toBe(201);
		const original = await readJson<{ reservationId: number }>(first);
		const repeat = await callRoute(bookRoute, options);
		expect(await readJson(repeat)).toEqual(original);
		const changed = await callRoute(bookRoute, { ...options, json: { ...body, firstName: "Different" } });
		expect(changed.status).toBe(409);
		expect(await prisma.flightReservation.count()).toBe(1);
		const provider = await prisma.afsOfflineBooking.findFirstOrThrow();
		expect(provider.passportNumber).toMatch(/^DEMO-/);
		await prisma.user.update({ where: { id: user.id }, data: { lastName: "Changed" } });
		await cancelFlightReservation(original.reservationId);
		expect((await prisma.flightReservation.findUniqueOrThrow({ where: { id: original.reservationId } })).status).toBe("CANCELLED");
	}, 60_000);

	it("recovers a committed local mirror when the final response persistence fails", async () => {
		const user = await createUser();
		const leg = await flight();
		const options = { method: "POST" as const, token: tokenFor(user.id), json: { ...passenger, flightIds: [leg.id] }, headers: { "Idempotency-Key": "flight-committed-response-lost" } };
		vi.spyOn(applicationDb.bookingRequest, "findUniqueOrThrow").mockRejectedValueOnce(new Error("Injected lost acknowledgement"));
		expect((await callRoute(bookRoute, options)).status).toBe(500);
		const retry = await callRoute(bookRoute, options);
		expect(retry.status).toBe(201);
		expect(await prisma.flightReservation.count()).toBe(1);
		expect(await prisma.afsOfflineBooking.count()).toBe(1);
	}, 60_000);

	it("recovers an issued demo ticket after interruption before its local mirror", async () => {
		const user = await createUser();
		const leg = await flight();
		const body = { email: passenger.email, firstName: passenger.firstName, lastName: passenger.lastName, flightIds: [leg.id], returnLegCount: null };
		const headers = { "Idempotency-Key": "flight-interrupted-before-mirror" };
		const request = buildRequest({ method: "POST", headers });
		await expect(idempotentExternal(request, user.id, "flight-book", body, async operationId => {
			await createBooking({ ...passenger, flightIds: [leg.id] }, operationId);
			throw new Error("Injected process interruption");
		})).rejects.toThrow("interruption");
		expect(await prisma.flightReservation.count()).toBe(0);
		const recovered = await callRoute(bookRoute, { method: "POST", token: tokenFor(user.id), json: body, headers });
		expect(recovered.status).toBe(201);
		expect(await prisma.afsOfflineBooking.count()).toBe(1);
		expect(await prisma.flightReservation.count()).toBe(1);
	}, 60_000);

	it("keeps an unknown external result pending and never repeats the provider call", async () => {
		const user = await createUser();
		const request = buildRequest({ method: "POST", headers: { "Idempotency-Key": "external-unknown-result" } });
		const provider = vi.fn(async () => { throw new Error("Injected remote timeout"); });
		await expect(idempotentExternal(request, user.id, "flight-book", { intent: "unknown" }, provider)).rejects.toThrow("timeout");
		await expect(idempotentExternal(request, user.id, "flight-book", { intent: "unknown" }, provider)).rejects.toMatchObject({ status: 409 });
		expect(provider).toHaveBeenCalledTimes(1);
		expect((await prisma.bookingRequest.findFirstOrThrow()).state).toBe("PENDING");
	}, 60_000);
});
