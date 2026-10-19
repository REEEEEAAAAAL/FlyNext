/**
 * `GET  /api/hotels` — public hotel search.
 * `POST /api/hotels` — create a hotel owned by the caller (multipart/form-data).
 *
 * Response contract, relied on by `app/hotels/page.tsx`, `app/hotels/new/page.tsx`
 * and `app/hotels/owner/page.tsx`:
 * - `200 { hotels: HotelWithRoomTypes[] }` (`roomTypes` always included)
 * - `401`, `400`, `201 { message: "Created successfully", hotelId: number }`
 * - `429 { error: string }`
 *
 * Filter strings are matched case-insensitively, because the caller is a search
 * box rather than a database query. They are also length-capped: an unbounded
 * `contains` is a free way to make the database scan every row.
 */

import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/api/auth";
import { badRequest } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonCreated, jsonOk } from "@/lib/api/response";
import { saveImageUploads } from "@/lib/api/upload";
import {
	parseOptionalNumber,
	readFormFiles,
	requireFormInt,
	requireFormString,
} from "@/lib/api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import type { HotelWithRoomTypes } from "@/types";
import { AVAILABILITY_HORIZON_ERROR, eachNight, isWithinAvailabilityHorizon, parseStayRange } from "@/lib/api/validation";
import { nightlyAvailability } from "@/lib/hotel-inventory";
import { money } from "@/lib/booking-locks";

/** Star ratings are constrained to the 1–5 scale the UI renders as ★/☆. */
const MIN_STARS = 1;
const MAX_STARS = 5;

/** Longest filter string accepted, matching the autocomplete endpoints. */
const MAX_FILTER_LENGTH = 100;

/** Read a trimmed, length-capped free-text filter. */
function readFilter(searchParams: URLSearchParams, field: string): string {
	const value = (searchParams.get(field) ?? "").trim();
	if (value.length > MAX_FILTER_LENGTH) {
		throw badRequest(`Parameter "${field}" must be at most ${MAX_FILTER_LENGTH} characters`);
	}
	return value;
}

export const GET = withRoute(async (request) => {
	await enforceRateLimit(request, "publicRead");
	const { searchParams } = new URL(request.url);
	const checkIn = searchParams.get("checkIn");
	const checkOut = searchParams.get("checkOut");
	if (Boolean(checkIn) !== Boolean(checkOut)) throw badRequest("Both checkIn and checkOut are required");
	const stay = checkIn && checkOut ? parseStayRange(checkIn, checkOut) : null;
	const dates = stay ? eachNight(stay.checkIn, stay.checkOut) : [];
	if (dates.some(date => !isWithinAvailabilityHorizon(date))) throw badRequest(AVAILABILITY_HORIZON_ERROR);

	const city = readFilter(searchParams, "city");
	const name = readFilter(searchParams, "name");
	const starRating = parseOptionalNumber(searchParams.get("starRating"), "starRating", {
		min: MIN_STARS,
		max: MAX_STARS,
	});
	const priceMin = parseOptionalNumber(searchParams.get("priceMin"), "priceMin", {
		min: 0,
	});
	const priceMax = parseOptionalNumber(searchParams.get("priceMax"), "priceMax", {
		min: 0,
	});

	const filters: Prisma.HotelWhereInput = {};
	if (city.length > 0) {
		filters.location = { contains: city, mode: "insensitive" };
	}
	if (name.length > 0) {
		filters.name = { contains: name, mode: "insensitive" };
	}
	if (starRating !== undefined) {
		filters.starRating = starRating;
	}
	if (priceMin !== undefined || priceMax !== undefined) {
		filters.roomTypes = {
			some: {
				pricePerNight: {
					...(priceMin !== undefined ? { gte: priceMin } : {}),
					...(priceMax !== undefined ? { lte: priceMax } : {}),
				},
			},
		};
	}

	const hotels = await prisma.hotel.findMany({
		where: filters,
		include: { roomTypes: true },
		orderBy: { id: "asc" },
	});

	// The client reads `data.hotels` with a `|| []` fallback, but the payload is
	// always well formed.
	const results = await Promise.all(hotels.map(async hotel => ({
		...hotel,
		roomTypes: (await Promise.all(hotel.roomTypes.map(async room => {
			const pricePerNight = money(room.pricePerNight);
			if (!stay) return { ...room, pricePerNight, availableRooms: null, nights: null, stayTotal: null, currency: "USD" as const };
			const rows = await nightlyAvailability(prisma, room, dates);
			return { ...room, pricePerNight, availableRooms: Math.min(...rows.map(row => row.availability)), nights: stay.nights, stayTotal: money(pricePerNight * stay.nights), currency: "USD" as const };
		}))).filter(room => (room.availableRooms === null || room.availableRooms > 0) && (priceMin === undefined || room.pricePerNight >= priceMin) && (priceMax === undefined || room.pricePerNight <= priceMax)),
	})));
	const payload: { hotels: HotelWithRoomTypes[] } = { hotels: results.filter(hotel => !stay || hotel.roomTypes.length > 0) };
	return jsonOk(payload);
});

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "bookingWrite");
	const formData = await request.formData();

	// Required text fields, in the order the error message lists them.
	const name = requireFormString(formData, "name", { maxLength: 200 });
	const address = requireFormString(formData, "address", { maxLength: 300 });
	const location = requireFormString(formData, "location", { maxLength: 200 });
	const starRating = requireFormInt(formData, "starRating", {
		min: MIN_STARS,
		max: MAX_STARS,
	});

	// The logo is optional and defaults to the bundled placeholder.
	const logoFiles = readFormFiles(formData, "logo");
	const imagesFiles = readFormFiles(formData, "images");

	if (logoFiles.length > 1) throw badRequest("Only one hotel logo is allowed.");
	const logoUrl = logoFiles.length ? (await saveImageUploads(logoFiles, "hotels"))[0] : "/hotel-logo-default.svg";
	const imagesUrls = await saveImageUploads(imagesFiles, "hotels");

	const hotel = await prisma.$transaction(async (tx) => {
		const created = await tx.hotel.create({
			data: {
				name,
				logo: logoUrl,
				address,
				location,
				starRating,
				images: imagesUrls,
				ownerId: userId,
			},
		});
		// Promote the account to hotel owner so the owner pages unlock.
		await tx.user.updateMany({
			where: { id: userId, IsHotelOwner: false },
			data: { IsHotelOwner: true },
		});
		return created;
	}, DEFAULT_TRANSACTION_OPTIONS);

	return jsonCreated({ message: "Created successfully", hotelId: hotel.id });
});
