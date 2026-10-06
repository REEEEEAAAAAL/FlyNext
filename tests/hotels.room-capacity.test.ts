/**
 * Capacity propagation from the room-type form to the per-night calendar.
 *
 * The owner's "Total Availability" field is the room type's configured capacity,
 * while each `RoomAvailabilityRecord` row is what a booking decrements. Two
 * properties have to hold together, and they pull in opposite directions:
 *
 * 1. Changing the capacity must reach the nights that are on sale. Filtering the
 *    rows by the new value matches nothing, because every materialised row is
 *    sitting at the previous capacity — which is how lowering availability
 *    to stop overselling becomes a silent no-op.
 * 2. A night a booking has already decremented must not be moved. The propagation
 *    therefore only touches rows still at the stored capacity, and skips an
 *    unchanged resubmission entirely: the edit form always sends
 *    `currentAvailability`, so "change only the price" arrives as the same value.
 *
 * Not a timezone test: rows and queries are both local midnight, so they shift
 * together.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as updateRoomType } from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { POST as bookHotel } from "@/app/api/hotels/book/route";
import { disconnect, prisma, resetDatabase } from "#support/db";
import {
	addDays,
	atMidnight,
	createHotel,
	createRoomType,
	createUser,
	toDateParam,
} from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await disconnect();
});

/** What the edit form submits: name, price, capacity and the gallery list. */
function editForm(values: {
	name?: string;
	pricePerNight?: string;
	currentAvailability?: string;
}): FormData {
	const data = new FormData();
	data.append("name", values.name ?? "Deluxe King");
	data.append("pricePerNight", values.pricePerNight ?? "100");
	if (values.currentAvailability !== undefined) {
		data.append("currentAvailability", values.currentAvailability);
	}
	data.append("existingImages", "[]");
	return data;
}

/** Availability for two nights a fortnight out, one of them booked. */
async function availabilityOn(
	roomTypeId: number,
	dates: Date[]
): Promise<number[]> {
	const rows = await prisma.roomAvailabilityRecord.findMany({
		where: { roomTypeId, date: { in: dates } },
		orderBy: { date: "asc" },
		select: { availability: true },
	});
	return rows.map((row) => row.availability);
}

describe("owner capacity edits reach the calendar", () => {
	it("applies a lowered capacity to the nights that are on sale", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const hotel = await createHotel({ ownerId: owner.id });
		const roomType = await createRoomType({
			hotelId: hotel.id,
			availability: 5,
			nights: 20,
		});
		const target = atMidnight(addDays(new Date(), 10));

		const response = await callRoute<{ hotelId: string; roomTypeId: string }>(
			updateRoomType,
			{
				method: "PUT",
				params: { hotelId: String(hotel.id), roomTypeId: String(roomType.id) },
				token: tokenFor(owner.id),
				formData: editForm({ currentAvailability: "2" }),
			}
		);

		expect(response.status).toBe(200);
		// Untouched nights drop to the new capacity...
		expect(await availabilityOn(roomType.id, [target])).toEqual([2]);
		// ...and the stored capacity agrees.
		const stored = await prisma.roomType.findUnique({
			where: { id: roomType.id },
			select: { currentAvailability: true },
		});
		expect(stored?.currentAvailability).toBe(2);
	});

	it("leaves a night a booking has already taken at its reduced count", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const guest = await createUser();
		const hotel = await createHotel({ ownerId: owner.id });
		const roomType = await createRoomType({
			hotelId: hotel.id,
			availability: 3,
			nights: 20,
		});

		const bookedNight = atMidnight(addDays(new Date(), 10));
		const booking = await callRoute(bookHotel, {
			method: "POST",
			token: tokenFor(guest.id),
			json: {
				hotelId: String(hotel.id),
				roomTypeId: String(roomType.id),
				checkIn: toDateParam(bookedNight),
				checkOut: toDateParam(addDays(bookedNight, 1)),
			},
		});
		expect(booking.status).toBe(201);
		// The booked night is one room down.
		expect(await availabilityOn(roomType.id, [bookedNight])).toEqual([2]);

		/*
		 * The owner lowers capacity to 1. The booked night is below the old
		 * capacity, so it is not a candidate: it must keep the room that was sold,
		 * not be reset to a full house.
		 */
		const response = await callRoute<{ hotelId: string; roomTypeId: string }>(
			updateRoomType,
			{
				method: "PUT",
				params: { hotelId: String(hotel.id), roomTypeId: String(roomType.id) },
				token: tokenFor(owner.id),
				formData: editForm({ currentAvailability: "1" }),
			}
		);
		expect(response.status).toBe(200);
		expect(await availabilityOn(roomType.id, [bookedNight])).toEqual([2]);

		// The reservation still stands and still owns that room.
		const reservations = await prisma.hotelReservation.count({
			where: { roomTypeId: roomType.id, status: "CONFIRMED" },
		});
		expect(reservations).toBe(1);
	});

	it("does not rewrite the calendar when only the price changes", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const guest = await createUser();
		const hotel = await createHotel({ ownerId: owner.id });
		const roomType = await createRoomType({
			hotelId: hotel.id,
			availability: 4,
			nights: 20,
		});

		const bookedNight = atMidnight(addDays(new Date(), 8));
		const booking = await callRoute(bookHotel, {
			method: "POST",
			token: tokenFor(guest.id),
			json: {
				hotelId: String(hotel.id),
				roomTypeId: String(roomType.id),
				checkIn: toDateParam(bookedNight),
				checkOut: toDateParam(addDays(bookedNight, 1)),
			},
		});
		expect(booking.status).toBe(201);

		const untouched = atMidnight(addDays(new Date(), 12));
		const before = await availabilityOn(roomType.id, [bookedNight, untouched]);
		expect(before).toEqual([3, 4]);

		// The form resubmits the unchanged capacity alongside the new price, which
		// is exactly what pressing Save without touching "Total Availability" sends.
		const response = await callRoute<{ hotelId: string; roomTypeId: string }>(
			updateRoomType,
			{
				method: "PUT",
				params: { hotelId: String(hotel.id), roomTypeId: String(roomType.id) },
				token: tokenFor(owner.id),
				formData: editForm({
					pricePerNight: "250",
					currentAvailability: String(roomType.currentAvailability),
				}),
			}
		);

		expect(response.status).toBe(200);
		const after = await availabilityOn(roomType.id, [bookedNight, untouched]);
		// Neither the sold night nor the free one moved.
		expect(after).toEqual([3, 4]);

		// The price did change, so the guard is not skipping the whole update.
		const stored = await prisma.roomType.findUnique({
			where: { id: roomType.id },
			select: { pricePerNight: true },
		});
		expect(stored?.pricePerNight).toBe(250);

		const stillBooked = await readJson<unknown>(booking);
		expect(stillBooked).toBeDefined();
	});
});
