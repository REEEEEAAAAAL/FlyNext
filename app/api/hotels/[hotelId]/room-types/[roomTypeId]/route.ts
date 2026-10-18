import { lockRoom, money } from "@/lib/booking-locks";
import { nightlyAvailability } from "@/lib/hotel-inventory";
import { eachDateInclusive } from "@/lib/api/validation";
/** Public room details and derived inventory are read-only. Guest bookings use the owner endpoint. */

import { requireAuth } from "@/lib/api/auth";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
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
	RoomTypeSummary,
} from "@/types";

/** Explicit public projection: guest reservations are served separately. */
interface RoomTypeDetail extends Omit<RoomTypeSummary, "images"> {
	images: unknown;
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

		const requested = readAvailabilityWindow(request);
		const availabilityRecords = await nightlyAvailability(prisma, roomType, eachDateInclusive(requested.from, requested.to));

		const detail: RoomTypeDetail = {
			id: roomType.id,
			name: roomType.name,
			amenities: roomType.amenities,
			pricePerNight: roomType.pricePerNight,
			images: roomType.images,
			currentAvailability: roomType.currentAvailability,
			hotelId: roomType.hotelId,
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
		await enforceRateLimit(request, "bookingWrite");

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
			updates.pricePerNight = money(requireFormNumber(formData, "pricePerNight", {
				min: 0,
			}));
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
			await lockRoom(tx, roomTypeId);
			const previous = await tx.roomType.findUniqueOrThrow({ where: { id: roomTypeId } });
			if (capacity !== undefined && capacity !== previous.currentAvailability) {
				const { days } = availabilityHorizon();
				await nightlyAvailability(tx, previous, days);
				const bookings = await tx.hotelReservation.findMany({ where: { roomTypeId, status: { not: "CANCELLED" }, checkOut: { gt: atMidnight(new Date()) } } });
				const changes = bookings.flatMap(booking => [{ time: booking.checkIn.getTime(), count: 1 }, { time: booking.checkOut.getTime(), count: -1 }]);
				changes.sort((a, b) => a.time - b.time || a.count - b.count);
				let occupied = 0;
				for (const change of changes) {
					occupied += change.count;
					if (occupied > capacity) throw conflict("Capacity cannot be lower than existing reservations");
				}
				const delta = capacity - previous.currentAvailability;
				const today = atMidnight(new Date()).toISOString().slice(0, 10);
				await tx.$executeRaw`UPDATE "RoomAvailabilityRecord" SET availability = LEAST(${capacity}, GREATEST(0, availability + ${delta})) WHERE "roomTypeId" = ${roomTypeId} AND date >= ${today}::date`;
			}
			const roomType = await tx.roomType.update({ where: { id: roomTypeId }, data: updates });

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
		await enforceRateLimit(request, "bookingWrite");

		await requireOwnedHotel(hotelId, userId);
		await requireRoomTypeOfHotel(hotelId, roomTypeId);

		// Availability records cascade; reservations keep their history with
		// `roomTypeId` set to null.
		await prisma.roomType.delete({ where: { id: roomTypeId } });

		return jsonMessage("Room type deleted", 200);
	}
);
