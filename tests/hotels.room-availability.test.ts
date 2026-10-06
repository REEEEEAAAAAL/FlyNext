/**
 * Room-type availability: creation must make the room type bookable.
 *
 * `POST /api/hotels/book` claims one availability row per night of the stay and
 * answers `400 "The selected date is not supported for booking."` when a night
 * lies outside the booking horizon. Creation therefore has to materialise the
 * whole supported horizon, because the sole other place that materialises it is
 * the room-type `GET` — which the guest flow never calls. Seeding only today would
 * leave a room type an owner had just created unbookable for any future stay until
 * the owner happened to open its calendar.
 *
 * The cases below pin the two halves of that contract: creation covers the whole
 * shared horizon, and a guest can immediately book inside it.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bookHotel } from "@/app/api/hotels/book/route";
import { POST as createRoomType } from "@/app/api/hotels/[hotelId]/room-types/route";
import { GET as getRoomType } from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { availabilityHorizon, AVAILABILITY_HORIZON_DAYS } from "@/lib/api/validation";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { addDays, atMidnight, createHotel, createUser, toDateParam } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await disconnect();
});

/** The multipart body `app/hotels/[hotelId]/room-types/new/page.tsx` submits. */
function roomTypeForm(overrides: { availability?: string } = {}): FormData {
	const data = new FormData();
	data.append("name", "Deluxe King");
	data.append("amenities", "Wi-Fi, Breakfast");
	data.append("pricePerNight", "180");
	data.append("currentAvailability", overrides.availability ?? "4");
	return data;
}

describe("room-type creation materialises the booking horizon", () => {
	it("creates an availability row for every night of the shared horizon", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const hotel = await createHotel({ ownerId: owner.id });

		const response = await callRoute<{ hotelId: string }>(createRoomType, {
			method: "POST",
			params: { hotelId: String(hotel.id) },
			token: tokenFor(owner.id),
			formData: roomTypeForm(),
		});

		expect(response.status).toBe(201);
		const body = await readJson<{ roomTypeId: number }>(response);
		const { days } = availabilityHorizon();

		const rows = await prisma.roomAvailabilityRecord.findMany({
			where: { roomTypeId: body.roomTypeId },
			select: { date: true, availability: true },
		});

		// Every night of the horizon exists — not just today.
		expect(rows.length).toBe(days.length);
		const stored = new Set(rows.map((row) => row.date.getTime()));
		for (const day of days) {
			expect(stored.has(day.getTime()), `missing ${day.toISOString()}`).toBe(true);
		}
		// And every one of them starts at the capacity the owner entered.
		expect(rows.every((row) => row.availability === 4)).toBe(true);
	});

	it("covers sixty nights ahead of today, whatever the date the month rolls on", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const hotel = await createHotel({ ownerId: owner.id });

		const response = await callRoute<{ hotelId: string }>(createRoomType, {
			method: "POST",
			params: { hotelId: String(hotel.id) },
			token: tokenFor(owner.id),
			formData: roomTypeForm(),
		});
		const { roomTypeId } = await readJson<{ roomTypeId: number }>(response);

		const rows = await prisma.roomAvailabilityRecord.findMany({
			where: { roomTypeId },
			orderBy: { date: "asc" },
			select: { date: true },
		});

		/*
		 * A fixed night count, not "two months". The window is checked here from
		 * both ends: it starts today, and its last night is exactly
		 * `AVAILABILITY_HORIZON_DAYS` ahead — the night a guest booking the
		 * furthest-away stay the site advertises will claim. Deriving the window
		 * with `setMonth` made that last night move depending on which day of the
		 * month the owner happened to create the room type on.
		 */
		const today = atMidnight(new Date());
		expect(rows.length).toBe(AVAILABILITY_HORIZON_DAYS + 1);
		expect(rows[0].date.getTime()).toBe(today.getTime());
		expect(rows[rows.length - 1].date.getTime()).toBe(
			addDays(today, AVAILABILITY_HORIZON_DAYS).getTime()
		);
	});

	it("leaves a guest able to book a future stay with no visit to the owner calendar", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const guest = await createUser();
		const hotel = await createHotel({ ownerId: owner.id });

		const created = await callRoute<{ hotelId: string }>(createRoomType, {
			method: "POST",
			params: { hotelId: String(hotel.id) },
			token: tokenFor(owner.id),
			formData: roomTypeForm(),
		});
		expect(created.status).toBe(201);
		const { roomTypeId } = await readJson<{ roomTypeId: number }>(created);

		// Two nights, a fortnight out: inside the horizon, far from today.
		// `atMidnight` because the stored rows are local midnight, and comparing
		// against a `Date` with a time component matches nothing.
		const checkIn = atMidnight(addDays(new Date(), 14));
		const checkOut = addDays(checkIn, 2);

		const booking = await callRoute(bookHotel, {
			method: "POST",
			token: tokenFor(guest.id),
			json: {
				hotelId: String(hotel.id),
				roomTypeId: String(roomTypeId),
				checkIn: toDateParam(checkIn),
				checkOut: toDateParam(checkOut),
			},
		});

		expect(booking.status).toBe(201);
		const booked = await readJson<{ reservation: { id: number } }>(booking);
		expect(booked.reservation.id).toBeGreaterThan(0);

		// Each night of the stay was decremented by exactly one.
		const nights = await prisma.roomAvailabilityRecord.findMany({
			where: {
				roomTypeId,
				date: { in: [checkIn, addDays(checkIn, 1)] },
			},
			select: { availability: true },
		});
		expect(nights.length).toBe(2);
		expect(nights.every((night) => night.availability === 3)).toBe(true);
	});

	it("keeps creation and the calendar on one window, so the calendar finds no gap to fill", async () => {
		const owner = await createUser({ IsHotelOwner: true });
		const hotel = await createHotel({ ownerId: owner.id });

		const created = await callRoute<{ hotelId: string }>(createRoomType, {
			method: "POST",
			params: { hotelId: String(hotel.id) },
			token: tokenFor(owner.id),
			formData: roomTypeForm({ availability: "7" }),
		});
		const { roomTypeId } = await readJson<{ roomTypeId: number }>(created);

		const before = await prisma.roomAvailabilityRecord.count({
			where: { roomTypeId },
		});

		// The owner's calendar read is the historical back-fill path. If creation
		// covered a narrower window, this would insert the difference.
		const calendar = await callRoute<{ hotelId: string; roomTypeId: string }>(
			getRoomType,
			{
				params: { hotelId: String(hotel.id), roomTypeId: String(roomTypeId) },
			}
		);
		expect(calendar.status).toBe(200);

		const after = await prisma.roomAvailabilityRecord.count({
			where: { roomTypeId },
		});
		expect(after).toBe(before);

		const body = await readJson<{ availabilityRecords: { date: string }[] }>(
			calendar
		);
		expect(body.availabilityRecords.length).toBe(before);
	});
});
