/**
 * `GET /api/user/flight-bookings` — the caller's flight booking history.
 *
 * Response contract, relied on by `app/user/flight-bookings/page.tsx` and
 * `app/itineraries/new/page.tsx`:
 * - `200 { bookings: FlightBookingListItem[] }`
 * - `401 { error: "Unauthorized" }`
 *
 * Each leg is normalised so that an absent value becomes the single-space
 * sentinel `" "`, which the pages map to `"N/A"` and test before rendering the
 * return block.
 *
 * `itineraryId` is part of the projection because `app/itineraries/new/page.tsx`
 * filters on it to decide which bookings are still linkable; without it every
 * booking looks unlinked and selecting an already-linked one fails with `409`.
 *
 * ## Why cancelled bookings are excluded here
 *
 * The only consumer that has to link a booking is the itinerary builder, and a
 * cancelled reservation can never be linked: `POST /api/itineraries` answers
 * `409 "This reservation has already been cancelled"`. Returning them made the
 * builder offer the traveller a choice that could only fail, and it was easy to
 * make by accident — the page's own filter tested `!itineraryId`, and a cancelled
 * booking has no itinerary, so cancelling a flight added it to the list.
 *
 * Filtering in the query rather than in the page also means the endpoint cannot
 * be talked into handing out a cancelled booking by a client that forgets the
 * check, and it stops the history list from growing without bound behind a page
 * that only ever wanted the live ones. The traveller's own history, including
 * everything they cancelled, remains available through
 * `GET /api/user/flight-bookings?includeCancelled=1`, which is what the booking
 * history page asks for.
 */

import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { toFlightLegDto } from "@/lib/reservations";
import type { FlightBookingListItem } from "@/types";

/** Query flag that opts a caller back into the cancelled bookings. */
const INCLUDE_CANCELLED_PARAM = "includeCancelled";

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);

	const { searchParams } = new URL(request.url);
	const includeCancelled =
		(searchParams.get(INCLUDE_CANCELLED_PARAM) ?? "").trim() === "1";

	const rows = await prisma.flightReservation.findMany({
		/*
		 * `status` is one enum value, so "only what is still live" is expressed as
		 * a negation rather than a list. Written out rather than built by spreading
		 * a conditional key, which is what let the two branches drift apart in the
		 * first place.
		 */
		where: includeCancelled
			? { userId }
			: { userId, status: { not: "CANCELLED" } },
		select: {
			id: true,
			afsBookingId: true,
			departure: true,
			arrival: true,
			price: true,
			status: true,
			itineraryId: true,
			createdAt: true,
		},
		orderBy: { createdAt: "desc" },
	});

	const bookings: FlightBookingListItem[] = rows.map((row) => ({
		id: row.id,
		status: row.status,
		afsBookingId: row.afsBookingId,
		price: row.price,
		departure: toFlightLegDto(row.departure),
		arrival: toFlightLegDto(row.arrival),
		itineraryId: row.itineraryId,
		createdAt: row.createdAt,
	}));

	return jsonOk({ bookings });
});
