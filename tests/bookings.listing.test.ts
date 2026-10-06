/**
 * The two booking-history list endpoints, as the Create Itinerary page uses them.
 *
 * The page offers a reservation for linking only when it is neither cancelled nor
 * already attached to an itinerary, and a cancelled reservation satisfies
 * `!itineraryId` — so a client-side filter built on `itineraryId` alone would add
 * every cancelled booking to the list of choices. Selecting one could only ever
 * fail: `POST /api/itineraries` answers `409 "This reservation has already been
 * cancelled"`.
 *
 * These cases pin the server half of the contract — cancelled rows are excluded
 * by default and reachable only through the explicit `includeCancelled=1` flag
 * that the booking history pages use — and the `itineraryId` projection the
 * client half depends on.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listFlightBookings } from "@/app/api/user/flight-bookings/route";
import { GET as listHotelBookings } from "@/app/api/user/hotel-bookings/route";
import { disconnect, prisma, resetDatabase } from "#support/db";
import {
	addDays,
	atMidnight,
	createFlightReservation,
	createHotel,
	createHotelReservation,
	createItinerary,
	createRoomType,
	createUser,
	toDateParam,
} from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";
import type { FlightBookingListItem, HotelBookingListItem } from "@/types";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await disconnect();
});

/** Mark one flight reservation cancelled, exactly as the cancel route does. */
async function cancelFlight(reservationId: number): Promise<void> {
	await prisma.flightReservation.update({
		where: { id: reservationId },
		data: { status: "CANCELLED" },
	});
}

async function cancelHotel(reservationId: number): Promise<void> {
	await prisma.hotelReservation.update({
		where: { id: reservationId },
		data: { status: "CANCELLED" },
	});
}

/** A stay belonging to `userId`, ready to be listed. */
async function seedStay(userId: number) {
	const hotel = await createHotel();
	const roomType = await createRoomType({ hotelId: hotel.id });
	const checkIn = atMidnight(addDays(new Date(), 2));
	return createHotelReservation({
		userId,
		hotelId: hotel.id,
		roomTypeId: roomType.id,
		checkIn,
		checkOut: addDays(checkIn, 2),
	});
}

describe("flight booking history", () => {
	it("omits cancelled reservations, so the itinerary builder cannot offer one", async () => {
		const user = await createUser();
		const live = await createFlightReservation({ userId: user.id });
		const dead = await createFlightReservation({ userId: user.id });
		await cancelFlight(dead.id);

		const response = await callRoute(listFlightBookings, {
			token: tokenFor(user.id),
		});
		expect(response.status).toBe(200);

		const body = await readJson<{ bookings: FlightBookingListItem[] }>(response);
		expect(body.bookings.map((booking) => booking.id)).toEqual([live.id]);
	});

	it("returns them again for the booking history page", async () => {
		const user = await createUser();
		const live = await createFlightReservation({ userId: user.id });
		const dead = await createFlightReservation({ userId: user.id });
		await cancelFlight(dead.id);

		const response = await callRoute(listFlightBookings, {
			token: tokenFor(user.id),
			query: "includeCancelled=1",
		});

		const body = await readJson<{ bookings: FlightBookingListItem[] }>(response);
		expect(new Set(body.bookings.map((booking) => booking.id))).toEqual(
			new Set([live.id, dead.id])
		);
	});

	it("reports the itinerary a reservation is already attached to", async () => {
		const user = await createUser();
		const itinerary = await createItinerary({ userId: user.id });
		const linked = await createFlightReservation({
			userId: user.id,
			itineraryId: itinerary.id,
		});

		const response = await callRoute(listFlightBookings, {
			token: tokenFor(user.id),
		});
		const body = await readJson<{ bookings: FlightBookingListItem[] }>(response);

		expect(body.bookings).toHaveLength(1);
		expect(body.bookings[0].itineraryId).toBe(itinerary.id);
		expect(body.bookings[0].id).toBe(linked.id);
	});

	it("never leaks another traveller's bookings", async () => {
		const user = await createUser();
		const other = await createUser();
		await createFlightReservation({ userId: other.id });

		const response = await callRoute(listFlightBookings, {
			token: tokenFor(user.id),
		});
		const body = await readJson<{ bookings: FlightBookingListItem[] }>(response);

		expect(body.bookings).toEqual([]);
	});
});

describe("hotel booking history", () => {
	it("omits cancelled stays, so the itinerary builder cannot offer one", async () => {
		const user = await createUser();
		const live = await seedStay(user.id);
		const dead = await seedStay(user.id);
		await cancelHotel(dead.id);

		const response = await callRoute(listHotelBookings, {
			token: tokenFor(user.id),
		});
		expect(response.status).toBe(200);

		const body = await readJson<{ bookings: HotelBookingListItem[] }>(response);
		expect(body.bookings.map((booking) => booking.id)).toEqual([live.id]);
	});

	it("returns them again for the booking history page", async () => {
		const user = await createUser();
		const live = await seedStay(user.id);
		const dead = await seedStay(user.id);
		await cancelHotel(dead.id);

		const response = await callRoute(listHotelBookings, {
			token: tokenFor(user.id),
			query: "includeCancelled=1",
		});

		const body = await readJson<{ bookings: HotelBookingListItem[] }>(response);
		expect(new Set(body.bookings.map((booking) => booking.id))).toEqual(
			new Set([live.id, dead.id])
		);
	});

	it("still carries the stay dates and price the picker labels with", async () => {
		const user = await createUser();
		const stay = await seedStay(user.id);

		const response = await callRoute(listHotelBookings, {
			token: tokenFor(user.id),
		});
		const body = await readJson<{ bookings: HotelBookingListItem[] }>(response);

		const booking = body.bookings[0];
		expect(booking.id).toBe(stay.id);
		expect(toDateParam(new Date(booking.period.checkIn))).toBe(
			toDateParam(stay.checkIn)
		);
		expect(booking.totalPrice).toBe(stay.price);
		expect(booking.roomType?.name).toBeTruthy();
	});

	it("never leaks another traveller's stays", async () => {
		const user = await createUser();
		const other = await createUser();
		await seedStay(other.id);

		const response = await callRoute(listHotelBookings, {
			token: tokenFor(user.id),
		});
		const body = await readJson<{ bookings: HotelBookingListItem[] }>(response);

		expect(body.bookings).toEqual([]);
	});
});
