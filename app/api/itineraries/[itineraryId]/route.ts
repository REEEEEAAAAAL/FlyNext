import { enforceRateLimit } from "@/lib/api/rate-limit";
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
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { lockTraveller } from "@/lib/booking-locks";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
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
	await enforceRateLimit(request, "bookingWrite");
		const { itineraryId: rawItineraryId } = await context.params;
		const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

		const itinerary = await prisma.$transaction(async tx => {
			await lockTraveller(tx, userId);
			const row = await tx.itinerary.findFirst({ where: { id: itineraryId, userId }, select: { id: true, status: true, flight: { select: { id: true, status: true } }, hotel: { select: { id: true, status: true } } } });
			if (row && row.status !== "CANCELLED") await tx.itinerary.update({ where: { id: itineraryId }, data: { cancellationRequested: true } });
			return row;
		}, DEFAULT_TRANSACTION_OPTIONS);
		if (itinerary === null) {
			throw forbidden("You do not have access to this itinerary");
		}

		if (itinerary.status === "CANCELLED") return jsonMessage("Itinerary and all related bookings canceled successfully", 200);
		if (itinerary.flight !== null && itinerary.flight.status === "CONFIRMED") {
			await cancelFlightReservation(itinerary.flight.id);
		}
		if (itinerary.hotel !== null && itinerary.hotel.status === "CONFIRMED") {
			await cancelHotelReservation(itinerary.hotel.id);
		}

		await prisma.$transaction(async tx => {
			await lockTraveller(tx, userId);
			const current = await tx.itinerary.findUniqueOrThrow({ where: { id: itineraryId }, include: { flight: true, hotel: true } });
			if (current.flight?.status === "CONFIRMED" || current.hotel?.status === "CONFIRMED") throw conflict("Some reservations still require cancellation; retry this request");
			await tx.itinerary.update({ where: { id: itineraryId }, data: { status: "CANCELLED", totalPrice: 0, cancellationRequested: false } });
		}, DEFAULT_TRANSACTION_OPTIONS);

		return jsonMessage(
			"Itinerary and all related bookings canceled successfully",
			200
		);
	}
);
