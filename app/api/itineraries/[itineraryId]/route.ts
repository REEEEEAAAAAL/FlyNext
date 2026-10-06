/**
 * `GET    /api/itineraries/[itineraryId]` — full itinerary detail.
 * `DELETE /api/itineraries/[itineraryId]` — cancel the itinerary and everything in it.
 *
 * Response contract, relied on by `app/checkout/page.tsx`,
 * `app/itineraries/[itineraryId]/page.tsx`, `app/invoice/page.tsx` and
 * `app/checkout/page.tsx`'s invoice link:
 * - `200` — the body is the itinerary itself, not wrapped in
 *   `{ itinerary }`; three components assign the parsed body straight into state.
 * - `403 { error: "You do not have access to this itinerary" }`
 * - `200 { message: "Itinerary and all related bookings canceled successfully" }`
 *
 * `DELETE` releases each linked booking through the shared helpers, which are
 * idempotent and tolerate a room type that has since been deleted, and then
 * re-prices the itinerary from the bookings that are actually still confirmed.
 * AFS authorises a flight cancellation by passenger surname, so the user row must
 * exist before any ticket is released.
 */

import { requireAuth } from "@/lib/api/auth";
import { forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { cancelFlightReservation, cancelHotelReservation } from "@/lib/reservations";
import type { ItineraryDetail } from "@/types";

/** Columns the itinerary client reads, shared by both handlers. */
const ITINERARY_DETAIL_SELECT = {
	id: true,
	flight: {
		select: {
			id: true,
			departure: true,
			arrival: true,
			price: true,
			status: true,
		},
	},
	hotel: {
		select: {
			id: true,
			hotel: { select: { name: true, address: true, location: true } },
			roomType: { select: { name: true } },
			checkIn: true,
			checkOut: true,
			price: true,
			status: true,
		},
	},
	totalPrice: true,
	bookingDate: true,
	status: true,
} as const;

export const GET = withRoute<{ itineraryId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	const { itineraryId: rawItineraryId } = await context.params;
	const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

	const itinerary = await prisma.itinerary.findFirst({
		where: { id: itineraryId, userId },
		select: ITINERARY_DETAIL_SELECT,
	});
	if (itinerary === null) {
		// Kept as 403: the client renders this message verbatim.
		throw forbidden("You do not have access to this itinerary");
	}

	// Bare object — deliberately not enveloped.
	const payload: ItineraryDetail = itinerary;
	return jsonOk(payload);
});

export const DELETE = withRoute<{ itineraryId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		const { itineraryId: rawItineraryId } = await context.params;
		const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

		const itinerary = await prisma.itinerary.findFirst({
			where: { id: itineraryId, userId },
			select: {
				id: true,
				status: true,
				// The reservation prices are needed to re-price the itinerary from
				// what actually remains confirmed.
				flight: { select: { id: true, price: true, status: true } },
				hotel: { select: { id: true, price: true, status: true } },
				totalPrice: true,
			},
		});
		if (itinerary === null) {
			throw forbidden("You do not have access to this itinerary");
		}

		// AFS authorises cancellation by passenger surname, so the user record
		// must exist before any flight can be released.
		let passengerLastName: string | null = null;
		if (itinerary.flight !== null && itinerary.flight.status === "CONFIRMED") {
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { lastName: true },
			});
			if (user === null) {
				throw notFound("User not found");
			}
			passengerLastName = user.lastName;
		}

		if (itinerary.flight !== null && passengerLastName !== null) {
			await cancelFlightReservation(itinerary.flight.id, passengerLastName);
		}
		if (itinerary.hotel !== null && itinerary.hotel.status === "CONFIRMED") {
			await cancelHotelReservation(itinerary.hotel.id);
		}

		/*
		 * Close the itinerary out from the state the bookings are actually in, not
		 * from the assumption that both cancellations just succeeded. Each helper
		 * is idempotent: a leg that was already cancelled had its price removed from
		 * the total by the call that cancelled it, so zeroing the total outright
		 * would understate an itinerary that still holds a confirmed booking. The
		 * rows are re-read because the values loaded above predate the cancels.
		 */
		const [flightRow, hotelRow] = await Promise.all([
			itinerary.flight === null
				? null
				: prisma.flightReservation.findUnique({
						where: { id: itinerary.flight.id },
						select: { price: true, status: true },
					}),
			itinerary.hotel === null
				? null
				: prisma.hotelReservation.findUnique({
						where: { id: itinerary.hotel.id },
						select: { price: true, status: true },
					}),
		]);
		const remaining =
			(flightRow?.status === "CONFIRMED" ? flightRow.price : 0) +
			(hotelRow?.status === "CONFIRMED" ? hotelRow.price : 0);

		await prisma.itinerary.update({
			where: { id: itineraryId },
			data: { status: "CANCELLED", totalPrice: remaining },
		});

		return jsonMessage(
			"Itinerary and all related bookings canceled successfully",
			200
		);
	}
);
