/**
 * `GET /api/hotels/owner` — the caller's hotels plus their reservations.
 *
 * Response contract, relied on by `app/hotels/owner/page.tsx`:
 * - `200 { hotels: HotelWithRoomTypes[], reservations: HotelReservation[] }`
 *   — the page assigns `data.hotels` with no fallback, so `hotels` must always
 *   be present and always an array.
 * - `401 { error: "Unauthorized" }`
 * - `403 { error: string }` — signed in, but the account is not a hotel owner.
 *
 * The owner gate is explicit even though the query is already scoped by `ownerId`
 * and a non-owner would merely receive an empty list: this endpoint is the owner
 * dashboard, it returns every reservation of the caller's hotels including guest
 * names, and the account flag — not the emptiness of a result set — is the thing
 * that decides whether the caller may see it. An explicit check also means the
 * endpoint keeps refusing non-owners if an owner-only field is added later.
 *
 * The owner page submits `city`, `name`, `starRating`, `priceMin` and
 * `priceMax`, and all five are applied to the query.
 */

import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/api/auth";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import {
	parseOptionalNumber,
	parseOptionalPositiveInt,
	parseDateOnly,
} from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

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

/**
 * Assert that the caller is a hotel owner.
 *
 * @returns the caller's user id, for the ownership filters below.
 * @throws ApiError `404` when the account no longer exists, `403` when it carries
 *   no owner flag.
 */
async function requireHotelOwner(userId: number): Promise<number> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { IsHotelOwner: true },
	});
	if (user === null) {
		throw notFound("User not found");
	}
	if (!user.IsHotelOwner) {
		throw forbidden("Only hotel owners can access this resource");
	}
	return userId;
}

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "publicRead");

	await requireHotelOwner(userId);

	const { searchParams } = new URL(request.url);
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
	const startDate = searchParams.get("startdate");
	const endDate = searchParams.get("enddate");
	const roomTypeId = parseOptionalPositiveInt(
		searchParams.get("roomTypeId"),
		"roomTypeId"
	);

	// Hotel filters: ownership is always applied on top of the user's filters.
	const hotelFilters: Prisma.HotelWhereInput = { ownerId: userId };
	if (city.length > 0) {
		hotelFilters.location = { contains: city, mode: "insensitive" };
	}
	if (name.length > 0) {
		hotelFilters.name = { contains: name, mode: "insensitive" };
	}
	if (starRating !== undefined) {
		hotelFilters.starRating = starRating;
	}
	if (priceMin !== undefined || priceMax !== undefined) {
		hotelFilters.roomTypes = {
			some: {
				pricePerNight: {
					...(priceMin !== undefined ? { gte: priceMin } : {}),
					...(priceMax !== undefined ? { lte: priceMax } : {}),
				},
			},
		};
	}

	const hotels = await prisma.hotel.findMany({
		where: hotelFilters,
		select: {
			id: true,
			name: true,
			logo: true,
			address: true,
			location: true,
			starRating: true,
			images: true,
			roomTypes: true,
		},
		orderBy: { id: "asc" },
	});

	// Reservations are scoped to the caller's hotels, never to the whole table.
	const hotelIds = hotels.map((hotel) => hotel.id);
	const reservationFilters: Prisma.HotelReservationWhereInput = {
		hotelId: { in: hotelIds },
	};
	const checkInFilter: Prisma.DateTimeFilter = {};
	if (startDate !== null && startDate.trim().length > 0) {
		checkInFilter.gte = parseDateOnly(startDate, "startdate");
	}
	if (endDate !== null && endDate.trim().length > 0) {
		checkInFilter.lte = parseDateOnly(endDate, "enddate");
	}
	if (Object.keys(checkInFilter).length > 0) {
		reservationFilters.checkIn = checkInFilter;
	}
	if (roomTypeId !== undefined) {
		reservationFilters.roomTypeId = roomTypeId;
	}

	/*
	 * The owner panel renders a guest name and the booked room type, so the
	 * projection names exactly those fields. `include: { user: true }` would
	 * serialise the whole `User` row — including the bcrypt `password` hash, the
	 * email and the phone number of every guest who ever stayed — into a response
	 * the browser holds in memory.
	 */
	const reservations = await prisma.hotelReservation.findMany({
		where: reservationFilters,
		select: {
			id: true,
			userId: true,
			hotelId: true,
			roomTypeId: true,
			checkIn: true,
			checkOut: true,
			price: true,
			status: true,
			createdAt: true,
			user: { select: { firstName: true, lastName: true } },
			roomType: { select: { id: true, name: true, pricePerNight: true } },
			hotel: { select: { id: true, name: true } },
		},
		orderBy: { checkIn: "asc" },
	});

	// `hotels` is always present and always an array: the owner page assigns
	// `data.hotels` without a fallback.
	const payload: { hotels: typeof hotels; reservations: typeof reservations } = {
		hotels,
		reservations,
	};
	return jsonOk(payload);
});
