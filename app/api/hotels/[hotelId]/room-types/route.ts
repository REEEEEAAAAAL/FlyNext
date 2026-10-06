/**
 * `GET  /api/hotels/[hotelId]/room-types` — list a hotel's room types (public).
 * `POST /api/hotels/[hotelId]/room-types` — create one (owner only, multipart).
 *
 * Response contract, relied on by `app/hotels/[hotelId]/room-types/new/page.tsx`
 * and `app/hotels/[hotelId]/page.tsx`:
 * - `200 { roomTypes: RoomTypeSummary[] }`
 * - `400`, `401`, `403`, `404`, `429 { error: string }`
 * - `201 { message: "Room type created", roomTypeId: number }`
 *
 * Creation is multipart, so every field is read as a string (a `File` where a
 * scalar is expected is ignored rather than reaching Prisma) and `pricePerNight`
 * and `currentAvailability` are validated before use. The room type and its first
 * availability row are written in one transaction, and that row is stamped at
 * local midnight — the granularity every other query compares against — so the new
 * room type is immediately bookable.
 */

import { requireAuth } from "@/lib/api/auth";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonCreated, jsonOk } from "@/lib/api/response";
import { saveImageUploads } from "@/lib/api/upload";
import {
	availabilityHorizon,
	parseRouteId,
	readFormFiles,
	readFormString,
	requireFormNumber,
} from "@/lib/api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import type { RoomTypeSummary } from "@/types";

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

export const GET = withRoute<{ hotelId: string }>(async (_request, context) => {
	const { hotelId: rawHotelId } = await context.params;
	const hotelId = parseRouteId(rawHotelId, "hotelId");

	const roomTypes = await prisma.roomType.findMany({
		where: { hotelId },
		orderBy: { id: "asc" },
	});

	const payload: { roomTypes: RoomTypeSummary[] } = { roomTypes };
	return jsonOk(payload);
});

export const POST = withRoute<{ hotelId: string }>(async (request, context) => {
	const { hotelId: rawHotelId } = await context.params;
	const hotelId = parseRouteId(rawHotelId, "hotelId");
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");

	await requireOwnedHotel(hotelId, userId);

	const formData = await request.formData();

	// The three required entries share the "Missing required fields" message;
	// `amenities` stays optional.
	const name = readFormString(formData, "name", { maxLength: 200 });
	const pricePerNight = readFormString(formData, "pricePerNight");
	const currentAvailability = readFormString(formData, "currentAvailability");
	if (
		name === undefined ||
		pricePerNight === undefined ||
		currentAvailability === undefined
	) {
		throw badRequest("Missing required fields");
	}

	const price = requireFormNumber(formData, "pricePerNight", { min: 0 });
	const availability = Number(currentAvailability);
	if (!Number.isInteger(availability) || availability < 0) {
		throw badRequest(
			'Field "currentAvailability" must be a non-negative integer'
		);
	}

	const imagesUrls = await saveImageUploads(
		readFormFiles(formData, "images"),
		"roomTypes"
	);
	const amenities = readFormString(formData, "amenities", { maxLength: 1000 });

	const roomType = await prisma.$transaction(async (tx) => {
		const created = await tx.roomType.create({
			data: {
				name,
				amenities: amenities ?? null,
				pricePerNight: price,
				images: imagesUrls,
				currentAvailability: availability,
				hotel: { connect: { id: hotelId } },
			},
		});
		/*
		 * Seed the whole calendar window, not just today.
		 *
		 * `POST /api/hotels/book` requires an availability row for every night of
		 * the stay and answers `400 "The selected date is not supported for
		 * booking."` when one is missing, so seeding today alone would leave a room
		 * type unbookable for any future stay. The only other place that
		 * materialises the window is the room-type `GET`, which is reached from the
		 * owner's calendar page — never from the guest flow (which renders the room
		 * types from `GET /api/hotels` and posts straight to `/api/hotels/book`).
		 * A newly created room type is therefore bookable immediately, without the
		 * owner having to open its calendar first.
		 *
		 * `upsert` keeps today's row correct rather than duplicating it, and one
		 * `createMany` covers the rest: the rows share `availability` and the
		 * window is the same one the calendar back-fills.
		 */
		const { days } = availabilityHorizon();
		const today = days[0];
		if (today !== undefined) {
			await tx.roomAvailabilityRecord.upsert({
				where: {
					roomTypeId_date: { roomTypeId: created.id, date: today },
				},
				create: {
					date: today,
					availability: created.currentAvailability,
					roomTypeId: created.id,
				},
				update: { availability: created.currentAvailability },
			});
		}

		const remaining = days.slice(1);
		if (remaining.length > 0) {
			await tx.roomAvailabilityRecord.createMany({
				data: remaining.map((date) => ({
					date,
					availability: created.currentAvailability,
					roomTypeId: created.id,
				})),
			});
		}

		return created;
	}, DEFAULT_TRANSACTION_OPTIONS);

	return jsonCreated({
		message: "Room type created",
		roomTypeId: roomType.id,
	});
});
