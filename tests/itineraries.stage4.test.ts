import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as book } from "@/app/api/hotels/book/route";
import { POST as assemble } from "@/app/api/itineraries/route";
import { POST as checkout } from "@/app/api/checkout/route";
import { DELETE as cancelTrip } from "@/app/api/itineraries/[itineraryId]/route";
import { cancelHotelReservation } from "@/lib/reservations";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { addDays, createHotel, createRoomType, createUser, tomorrow, toDateParam } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";
import * as afs from "@/lib/afs-client";
import { createFlightReservation, cancelFlightReservation } from "@/lib/reservations";

beforeEach(resetDatabase);
afterAll(disconnect);
afterEach(() => vi.restoreAllMocks());
async function fixture() {
	const user = await createUser();
	const hotel = await createHotel({});
	const room = await createRoomType({ hotelId: hotel.id, availability: 2, pricePerNight: 99.99 });
	const token = tokenFor(user.id);
	const result = await callRoute(book, { method: "POST", token, json: { hotelId: hotel.id, roomTypeId: room.id, checkIn: toDateParam(tomorrow()), checkOut: toDateParam(addDays(tomorrow(), 3)) } });
	expect(result.status).toBe(201);
	const { reservation } = await readJson<{ reservation: { id: number } }>(result);
	return { user, hotel, room, token, reservation };
}

describe("stage 4 itinerary state and concurrency", () => {
	it("blocks linking and checkout while an upstream cancellation is unresolved, then permits retry", async () => {
		const f = await fixture();
		const date = new Date(); date.setUTCDate(date.getUTCDate() + 14);
		const legs = (await afs.searchFlights({ origin: "YYZ", destination: "LHR", date: date.toISOString().slice(0, 10) }))[0]!.flights;
		const flight = await createFlightReservation({ firstName: "Demo", lastName: "Traveller", email: "demo@example.com", passportNumber: "DEMO-PASSENGER", flightIds: legs.map(leg => leg.id) }, f.user.id);
		vi.spyOn(afs, "cancelFlight").mockRejectedValueOnce(new Error("Injected upstream timeout"));
		await expect(cancelFlightReservation(flight.reservationId)).rejects.toThrow("timeout");
		const result = await callRoute(assemble, { method: "POST", token: f.token, json: { flightReservationId: flight.reservationId } });
		expect(result.status).toBe(409);
		expect((await prisma.flightReservation.findUniqueOrThrow({ where: { id: flight.reservationId } })).cancellationPending).toBe(true);
		const trip = await prisma.itinerary.create({ data: { userId: f.user.id, status: "DRAFT", totalPrice: 100, cardNumber: "", cardExpiry: "", flight: { connect: { id: flight.reservationId } } } });
		const blocked = await callRoute(checkout, { method: "POST", token: f.token, json: { itineraryId: trip.id, paymentMethod: "DEMO" } });
		expect(blocked.status).toBe(409);
		await cancelFlightReservation(flight.reservationId);
		expect((await prisma.flightReservation.findUniqueOrThrow({ where: { id: flight.reservationId } })).status).toBe("CANCELLED");
	}, 60_000);
	it("serializes linking against cancellation and never totals cancelled items", async () => {
		const f = await fixture();
		const outcomes = await Promise.allSettled([
			callRoute(assemble, { method: "POST", token: f.token, json: { hotelReservationId: f.reservation.id } }),
			cancelHotelReservation(f.reservation.id),
		]);
		for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
		const linked = (outcomes[0] as PromiseFulfilledResult<Response>).value;
		expect([201, 409]).toContain(linked.status);
		const rows = await prisma.itinerary.findMany();
		expect(rows.every(row => row.totalPrice === 0)).toBe(true);
		expect((await prisma.hotelReservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).status).toBe("CANCELLED");
	}, 60_000);

	it("one itinerary claims a reservation and a repeated key returns the same draft", async () => {
		const f = await fixture();
		const options = { method: "POST" as const, token: f.token, json: { hotelReservationId: f.reservation.id }, headers: { "Idempotency-Key": "trip-create-lost-response" } };
		const results = await Promise.all([callRoute(assemble, options), callRoute(assemble, options)]);
		expect(results.map(result => result.status)).toEqual([201, 201]);
		expect(await readJson(results[0])).toEqual(await readJson(results[1]));
		const another = await callRoute(assemble, { ...options, headers: { "Idempotency-Key": "different-trip-intent" } });
		expect(another.status).toBe(409);
		expect(await prisma.itinerary.count()).toBe(1);
	}, 60_000);

	it("confirms DRAFT once, replays an immutable demo confirmation, and rejects checkout after cancellation", async () => {
		const f = await fixture();
		const created = await callRoute(assemble, { method: "POST", token: f.token, json: { hotelReservationId: f.reservation.id } });
		const { reservations: trip } = await readJson<{ reservations: { id: number } }>(created);
		const body = { itineraryId: trip.id, paymentMethod: "DEMO" };
		const options = { method: "POST" as const, token: f.token, json: body, headers: { "Idempotency-Key": "demo-checkout-response" } };
		const results = await Promise.all([callRoute(checkout, options), callRoute(checkout, { ...options, headers: { "Idempotency-Key": "second-checkout-intent" } })]);
		expect(results.map(r => r.status)).toEqual([200, 200]);
		const first = await readJson<{ itinerary: { totalPrice: number; paymentMethod: string; confirmedAt: string } }>(results[0]);
		expect(await readJson(results[1])).toEqual(first);
		expect(first.itinerary.totalPrice).toBe(299.97);
		expect(first.itinerary.paymentMethod).toBe("DEMO");
		const stored = await prisma.itinerary.findUniqueOrThrow({ where: { id: trip.id } });
		expect(stored.cardNumber).toBe(""); expect(stored.cardExpiry).toBe("");
		const cancels = await Promise.all([0, 1].map(() => callRoute(cancelTrip, { method: "DELETE", token: f.token, params: { itineraryId: String(trip.id) } })));
		expect(cancels.every(r => r.status === 200)).toBe(true);
		const after = await prisma.itinerary.findUniqueOrThrow({ where: { id: trip.id } });
		expect(after.status).toBe("CANCELLED"); expect(after.totalPrice).toBe(0);
		expect(after.confirmationTotal).toBe(299.97);
		const newCheckout = await callRoute(checkout, { ...options, headers: { "Idempotency-Key": "checkout-after-cancel" } });
		expect(newCheckout.status).toBe(409);
		const replay = await callRoute(checkout, options);
		expect(await readJson(replay)).toEqual(first);
	}, 60_000);

	it("checkout versus whole-itinerary cancellation cannot revive cancelled bookings", async () => {
		const f = await fixture();
		const created = await callRoute(assemble, { method: "POST", token: f.token, json: { hotelReservationId: f.reservation.id } });
		const { reservations: trip } = await readJson<{ reservations: { id: number } }>(created);
		const [paid, cancelled] = await Promise.all([
			callRoute(checkout, { method: "POST", token: f.token, json: { itineraryId: trip.id, paymentMethod: "DEMO" } }),
			callRoute(cancelTrip, { method: "DELETE", token: f.token, params: { itineraryId: String(trip.id) } }),
		]);
		expect([200, 409]).toContain(paid.status); expect(cancelled.status).toBe(200);
		const row = await prisma.itinerary.findUniqueOrThrow({ where: { id: trip.id } });
		expect(row.status).toBe("CANCELLED"); expect(row.totalPrice).toBe(0);
	}, 60_000);
});
