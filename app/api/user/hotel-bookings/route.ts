/**
 * `GET /api/user/hotel-bookings` — the caller's hotel booking history.
 *
 * Response contract, relied on by `app/user/hotel-bookings/page.tsx` and
 * `app/itineraries/new/page.tsx`:
 * - `200 { bookings: HotelBookingListItem[] }`
 * - `401 { error: "Unauthorized" }`
 *
 * The client reads `b.hotel.name`, `b.roomType?.name`, `b.period.checkIn` and
 * `b.totalPrice` — the stay dates arrive in a nested `period` envelope here,
 * whereas the detail endpoint returns them flat. Both shapes are load-bearing.
 *
 * `hotelId` and `roomTypeId` are both nullable (`onDelete: SetNull`), so a deleted
 * hotel or room type must not break the list: the fields degrade to a placeholder
 * instead of throwing, and the `itineraryId` column is returned because
 * `app/itineraries/new/page.tsx` filters on it to decide which bookings are still
 * linkable.
 *
 * ## Why cancelled stays are excluded by default
 *
 * A cancelled stay can never be linked to an itinerary — `POST /api/itineraries`
 * answers `409` — so offering it in the builder is offering a choice that can
 * only fail. Worse, the builder's own filter tested `!itineraryId`, and a
 * cancelled stay has no itinerary, so cancelling a hotel booking added it to
 * the list of selectable ones.
 *
 * `?includeCancelled=1` restores the full history for the booking history page,
 * which is the one consumer that legitimately wants to show what was cancelled.
 */

import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { HotelBookingListItem } from "@/types";

/** Shown when the hotel record has been deleted (`hotelId` is nullable). */
const UNKNOWN_HOTEL = "Hotel no longer available";

/** Query flag that opts a caller back into the cancelled stays. */
const INCLUDE_CANCELLED_PARAM = "includeCancelled";

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);

	const { searchParams } = new URL(request.url);
	const includeCancelled =
		(searchParams.get(INCLUDE_CANCELLED_PARAM) ?? "").trim() === "1";

	const rows = await prisma.hotelReservation.findMany({
		where: includeCancelled
			? { userId }
			: { userId, status: { not: "CANCELLED" } },
		select: {
			id: true,
			checkIn: true,
			checkOut: true,
			price: true,
			status: true,
			itineraryId: true,
			hotel: { select: { name: true, address: true, location: true } },
			roomType: { select: { name: true, amenities: true } },
			createdAt: true,
		},
		orderBy: { checkIn: "desc" },
	});

	const bookings: HotelBookingListItem[] = rows.map((row) => ({
		id: row.id,
		status: row.status,
		itineraryId: row.itineraryId,
		period: {
			checkIn: row.checkIn,
			checkOut: row.checkOut,
		},
		hotel: {
			name: row.hotel?.name ?? UNKNOWN_HOTEL,
			address: row.hotel?.address ?? "",
			location: row.hotel?.location ?? "",
		},
		roomType:
			row.roomType === null
				? null
				: { name: row.roomType.name, amenities: row.roomType.amenities },
		totalPrice: row.price,
		createdAt: row.createdAt,
	}));

	return jsonOk({ bookings });
});
