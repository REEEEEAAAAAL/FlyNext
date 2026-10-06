/**
 * `GET    /api/hotels/[hotelId]/room-types/[roomTypeId]`
 * `PUT    /api/hotels/[hotelId]/room-types/[roomTypeId]`
 * `DELETE /api/hotels/[hotelId]/room-types/[roomTypeId]`
 *
 * Response contract, relied on by
 * `app/hotels/[hotelId]/room-types/[roomTypeId]/page.tsx` (public, no headers)
 * and `.../edit/page.tsx`:
 * - `200 { roomType, availabilityRecords }` — `reservations` stays nested
 *   inside `roomType`, while `availabilityRecords` is a top-level key
 * - `200 { message: "Room type updated", roomType: { … } }`
 * - `200 { message: "Room type deleted" }`
 * - `400`, `401`, `403`, `404`, `429 { error: string }`
 *
 * Three properties hold across the handlers:
 *
 * 1. `hotelId` is asserted, not assumed. `PUT` and `DELETE` verify
 *    `roomType.hotelId === hotelId` before touching anything, so owning hotel A
 *    does not authorise editing a room type that belongs to hotel B — pairing an
 *    owned `hotelId` with a foreign `roomTypeId` is a `404`.
 *
 * 2. `GET` materialises the calendar in two queries. The window is read with
 *    one `findMany` and the gaps filled with one `createMany({ skipDuplicates })`,
 *    instead of a per-day read and insert against a remote database on every page
 *    view. `skipDuplicates` makes a concurrent first view harmless.
 *
 * 3. `guestName` is synthesised. The owner's reservations panel renders
 *    `reservation.guestName`, which is not a column on `HotelReservation`; it is
 *    joined from the related user.
 *
 * 4. `GET` answers the owner's `checkIn`/`checkOut` filter. The calendar's full
 *    horizon is still materialised — the rows have to exist for a booking to
 *    decrement — but only the requested days are returned.
 *
 * A capacity change on `PUT` propagates to the nights that are still at full
 * capacity, so the owner's availability control applies to the dates on sale
 * rather than only to rows created afterwards.
 */

import { requireAuth } from "@/lib/api/auth";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { resolveImageEntries } from "@/lib/api/upload";
import {
	atMidnight,
	availabilityHorizon,
	parseDateOnly,
	parseRouteId,
	readFormString,
	requireFormNumber,
} from "@/lib/api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import type {
	AvailabilityRecordDto,
	RoomTypeReservationDto,
	RoomTypeSummary,
} from "@/types";

/** Shape returned to the client: a room type with its owner-facing bookings. */
interface RoomTypeDetail extends Omit<RoomTypeSummary, "images"> {
	images: unknown;
	reservations: RoomTypeReservationDto[];
}

/**
 * Resolve the room type named by the URL and confirm it belongs to `hotelId`.
 *
 * A mismatch is reported as `404` rather than `403`: the caller has no business
 * learning that the id exists in another hotel.
 */
async function requireRoomTypeOfHotel(hotelId: number, roomTypeId: number) {
	const roomType = await prisma.roomType.findUnique({
		where: { id: roomTypeId },
		include: {
			reservations: {
				select: {
					id: true,
					userId: true,
					checkIn: true,
					checkOut: true,
					price: true,
					status: true,
					user: { select: { firstName: true, lastName: true } },
				},
				orderBy: { checkIn: "asc" },
			},
		},
	});
	if (roomType === null || roomType.hotelId !== hotelId) {
		throw notFound("Room type not found");
	}
	return roomType;
}

/** Load a hotel and assert the caller owns it. */
async function requireOwnedHotel(hotelId: number, userId: number) {
	const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });
	if (hotel === null) {
		throw notFound("Hotel not found");
	}
	if (hotel.ownerId !== userId) {
		throw forbidden("Forbidden");
	}
	return hotel;
}

/** Join the guest's name onto a reservation row. */
function toReservationDto(row: {
	id: number;
	userId: number;
	checkIn: Date;
	checkOut: Date;
	price: number;
	status: RoomTypeReservationDto["status"];
	user: { firstName: string; lastName: string };
}): RoomTypeReservationDto {
	return {
		id: row.id,
		userId: row.userId,
		checkIn: row.checkIn,
		checkOut: row.checkOut,
		price: row.price,
		status: row.status,
		guestName: `${row.user.firstName} ${row.user.lastName}`.trim(),
	};
}

/**
 * The window of availability rows to return.
 *
 * `app/hotels/[hotelId]/room-types/[roomTypeId]/edit/page.tsx` submits the
 * owner's `checkIn`/`checkOut` filter as query parameters, and this reads them:
 * pressing the filter narrows the response to the range it names rather than
 * re-fetching the whole horizon.
 *
 * A partially supplied or inverted range falls back to the full horizon rather
 * than erroring: the values come from two date inputs on a page that also loads
 * without them, and an empty calendar would be a worse answer than a wide one.
 */
function readAvailabilityWindow(request: Request): { from: Date; to: Date } {
	const { searchParams } = new URL(request.url);
	const checkIn = (searchParams.get("checkIn") ?? "").trim();
	const checkOut = (searchParams.get("checkOut") ?? "").trim();

	// The same window `POST .../room-types` seeds, so a night cannot be covered by
	// one and missing from the other.
	const { start: today, end: horizon } = availabilityHorizon();

	if (checkIn.length === 0 || checkOut.length === 0) {
		return { from: today, to: horizon };
	}

	// `parseDateOnly` rejects a malformed date with a `400`, and clamps to the
	// materialised horizon so a caller cannot ask for a range that no row covers.
	const from = parseDateOnly(checkIn, "checkIn");
	const to = parseDateOnly(checkOut, "checkOut");
	if (to.getTime() < from.getTime()) {
		return { from: today, to: horizon };
	}

	return {
		from: from.getTime() < today.getTime() ? today : from,
		to: to.getTime() > horizon.getTime() ? horizon : to,
	};
}

export const GET = withRoute<{ hotelId: string; roomTypeId: string }>(
	async (request, context) => {
		const { hotelId: rawHotelId, roomTypeId: rawRoomTypeId } = await context.params;
		const hotelId = parseRouteId(rawHotelId, "hotelId");
		const roomTypeId = parseRouteId(rawRoomTypeId, "roomTypeId");

		const roomType = await requireRoomTypeOfHotel(hotelId, roomTypeId);

		// Calendar window: today at local midnight through the shared horizon, which
		// is the same window `POST .../room-types` seeds at creation.
		const { start, end: horizon, days } = availabilityHorizon();

		/*
		 * The owner's availability filter narrows the response, not the
		 * materialisation. The calendar is what needs every day of the horizon to
		 * exist, so the gap-filling below always covers the full window; the filter
		 * only decides which of those days come back. Skipping the materialisation
		 * outside the requested range would leave the calendar with holes the
		 * moment a booking tried to decrement a night that was never created.
		 */
		const requested = readAvailabilityWindow(request);

		// One query for the whole window, then a single bulk insert for the gaps.
		const existing = await prisma.roomAvailabilityRecord.findMany({
			where: { roomTypeId, date: { gte: start, lte: horizon } },
			select: { date: true },
		});
		const existingDays = new Set(existing.map((row) => row.date.getTime()));
		const missingDays = days.filter((day) => !existingDays.has(day.getTime()));

		if (missingDays.length > 0) {
			// `skipDuplicates` keeps this a bulk insert while tolerating a parallel
			// request that materialises the same days first: the unique index on
			// `(roomTypeId, date)` turns the race into an ignored conflict instead
			// of a failed page view.
			await prisma.roomAvailabilityRecord.createMany({
				data: missingDays.map((date) => ({
					date,
					availability: roomType.currentAvailability,
					roomTypeId,
				})),
				skipDuplicates: true,
			});
		}

		const availabilityRecords: AvailabilityRecordDto[] =
			await prisma.roomAvailabilityRecord.findMany({
				where: {
					roomTypeId,
					date: { gte: requested.from, lte: requested.to },
				},
				orderBy: { date: "asc" },
			});

		const detail: RoomTypeDetail = {
			id: roomType.id,
			name: roomType.name,
			amenities: roomType.amenities,
			pricePerNight: roomType.pricePerNight,
			images: roomType.images,
			currentAvailability: roomType.currentAvailability,
			hotelId: roomType.hotelId,
			reservations: roomType.reservations.map(toReservationDto),
		};

		return jsonOk({ roomType: detail, availabilityRecords });
	}
);

export const PUT = withRoute<{ hotelId: string; roomTypeId: string }>(
	async (request, context) => {
		const { hotelId: rawHotelId, roomTypeId: rawRoomTypeId } = await context.params;
		const hotelId = parseRouteId(rawHotelId, "hotelId");
		const roomTypeId = parseRouteId(rawRoomTypeId, "roomTypeId");
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");

		await requireOwnedHotel(hotelId, userId);
		await requireRoomTypeOfHotel(hotelId, roomTypeId);

		const formData = await request.formData();

		const updates: {
			name?: string;
			amenities?: string | null;
			pricePerNight?: number;
			currentAvailability?: number;
			images?: string[];
		} = {};

		const name = readFormString(formData, "name", { maxLength: 200 });
		if (name !== undefined) {
			updates.name = name;
		}
		// An empty submission keeps the stored value; a present field replaces it.
		const amenities = readFormString(formData, "amenities", { maxLength: 1000 });
		if (amenities !== undefined) {
			updates.amenities = amenities;
		}
		if (readFormString(formData, "pricePerNight") !== undefined) {
			updates.pricePerNight = requireFormNumber(formData, "pricePerNight", {
				min: 0,
			});
		}
		const availabilityRaw = readFormString(formData, "currentAvailability");
		let capacity: number | undefined;
		if (availabilityRaw !== undefined) {
			const availability = Number(availabilityRaw);
			if (!Number.isInteger(availability) || availability < 0) {
				throw badRequest(
					'Field "currentAvailability" must be a non-negative integer'
				);
			}
			updates.currentAvailability = availability;
			capacity = availability;
		}

		// The gallery is replaced wholesale by the submitted list.
		updates.images = await resolveImageEntries(formData, "images", "roomTypes");

		const updatedRoomType = await prisma.$transaction(async (tx) => {
			/*
			 * The nights that are still at the stored capacity have to be
			 * identified before the room type is written.
			 *
			 * `capacity` is the new value and `currentAvailability` is about to
			 * become it, so filtering the rows by the post-update value matches
			 * nothing: every materialised night is sitting at the earlier
			 * capacity and none of them equals the new one. The owner's control
			 * then silently applies to no dates at all — lowering availability to
			 * stop overselling would leave every future night on sale at the
			 * previous number.
			 */
			const previousCapacity =
				capacity === undefined
					? undefined
					: (
							await tx.roomType.findUnique({
								where: { id: roomTypeId },
								select: { currentAvailability: true },
							})
						)?.currentAvailability;

			const roomType = await tx.roomType.update({
				where: { id: roomTypeId },
				data: updates,
			});

			/*
			 * A capacity change propagates to the calendar, but only to the nights
			 * that are still at full capacity.
			 *
			 * The per-night `RoomAvailabilityRecord` rows are what a booking
			 * decrements, while `currentAvailability` is the capacity the room type
			 * was configured with; without this step the owner's control would apply
			 * to nothing already materialised, so lowering it to stop overselling
			 * would have no effect on the dates on sale. A night whose `availability`
			 * is below capacity has at least one booking against it, and changing it
			 * would either erase a sold room or invent one, so those rows are left
			 * untouched and forgo the delta.
			 *
			 * The `capacity !== previousCapacity` guard matters because the edit form
			 * always resubmits `currentAvailability`: "change only the price" arrives
			 * as an unchanged capacity, and the filter below matches
			 * `availability: previousCapacity` — the stored value. Running it for an
			 * unchanged resubmission therefore has nothing legitimate to do, while
			 * still being a write against `RoomAvailabilityRecord` rows that a
			 * concurrent booking may be claiming in the same instant, in a transaction
			 * that has no lock on them. There is nothing to propagate when the value is
			 * the same, so it is not run at all.
			 */
			if (
				capacity !== undefined &&
				previousCapacity !== undefined &&
				capacity !== previousCapacity
			) {
				await tx.roomAvailabilityRecord.updateMany({
					where: {
						roomTypeId,
						date: { gte: atMidnight(new Date()) },
						availability: previousCapacity,
					},
					data: { availability: capacity },
				});
			}

			return roomType;
		}, DEFAULT_TRANSACTION_OPTIONS);

		return jsonOk({ message: "Room type updated", roomType: updatedRoomType });
	}
);

export const DELETE = withRoute<{ hotelId: string; roomTypeId: string }>(
	async (request, context) => {
		const { hotelId: rawHotelId, roomTypeId: rawRoomTypeId } = await context.params;
		const hotelId = parseRouteId(rawHotelId, "hotelId");
		const roomTypeId = parseRouteId(rawRoomTypeId, "roomTypeId");
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");

		await requireOwnedHotel(hotelId, userId);
		await requireRoomTypeOfHotel(hotelId, roomTypeId);

		// Availability records cascade; reservations keep their history with
		// `roomTypeId` set to null.
		await prisma.roomType.delete({ where: { id: roomTypeId } });

		return jsonMessage("Room type deleted", 200);
	}
);
