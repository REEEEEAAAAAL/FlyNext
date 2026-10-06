/**
 * `GET    /api/user/flight-bookings/[bookingId]` — booking detail.
 * `POST   /api/user/flight-bookings/[bookingId]` — verify the flight status.
 * `DELETE /api/user/flight-bookings/[bookingId]` — cancel the booking.
 *
 * Response contract, relied on by
 * `app/user/flight-bookings/[bookingId]/page.tsx`:
 * - `200 { booking: FlightBookingDetail }`
 * - `200 { message: "Flight is on schedule" | "Flight booking cancelled successfully" }`
 * - `400`, `401`, `404`, `409 { error: string }`
 * - `502 { error: string }` when AFS fails, or when the flight is not on schedule
 *
 * `bookingId` is validated as a positive integer, every response is scoped to the
 * caller, and the "not on schedule" message reports the first leg's status
 * rather than reading a property off the legs array. Cancelling runs through the
 * shared helper, which adjusts the itinerary price inside the same transaction and
 * cannot be skipped without failing the request.
 */

import { requireAuth } from "@/lib/api/auth";
import { badGateway, conflict, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { verifyFlight } from "@/lib/afs-client";
import { prisma } from "@/lib/prisma";
import { cancelFlightReservation, toFlightLegDto } from "@/lib/reservations";
import type { FlightBookingDetail } from "@/types";

/** Columns returned by the detail endpoint. */
const BOOKING_SELECT = {
	id: true,
	afsBookingId: true,
	departure: true,
	arrival: true,
	price: true,
	status: true,
	itineraryId: true,
	createdAt: true,
} as const;

/** Load one booking, scoped to its owner. */
async function loadBooking(bookingId: number, userId: number) {
	const booking = await prisma.flightReservation.findFirst({
		where: { id: bookingId, userId },
		select: BOOKING_SELECT,
	});
	if (booking === null) {
		throw notFound("Booking not found");
	}
	return booking;
}

export const GET = withRoute<{ bookingId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	const { bookingId: rawBookingId } = await context.params;
	const bookingId = parseRouteId(rawBookingId, "bookingId");

	const booking = await loadBooking(bookingId, userId);

	const payload: FlightBookingDetail = {
		...booking,
		departure: toFlightLegDto(booking.departure),
		arrival: toFlightLegDto(booking.arrival),
	};
	return jsonOk({ booking: payload });
});

export const POST = withRoute<{ bookingId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	const { bookingId: rawBookingId } = await context.params;
	const bookingId = parseRouteId(rawBookingId, "bookingId");

	const booking = await loadBooking(bookingId, userId);

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { lastName: true },
	});
	if (user === null) {
		throw notFound("User not found");
	}

	const verification = await verifyFlight(booking.afsBookingId, user.lastName);
	const legs = verification.flights;
	const firstLegStatus = legs[0]?.status;
	const secondLegStatus = legs[1]?.status;

	if (
		verification.status === "CONFIRMED" &&
		firstLegStatus === "SCHEDULED" &&
		(legs.length < 2 || secondLegStatus === "SCHEDULED")
	) {
		return jsonMessage("Flight is on schedule", 200);
	}

	// The page treats this as a failure and renders the message.
	throw badGateway(`Flight is ${firstLegStatus ?? verification.status}`);
});

export const DELETE = withRoute<{ bookingId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");
		const { bookingId: rawBookingId } = await context.params;
		const bookingId = parseRouteId(rawBookingId, "bookingId");

		const booking = await loadBooking(bookingId, userId);
		if (booking.status !== "CONFIRMED") {
			return jsonMessage("Flight booking is already cancelled", 200);
		}

		// An itinerary that has been cancelled has already settled its total; a leg
		// released afterwards would decrement it a second time.
		if (booking.itineraryId !== null) {
			const itinerary = await prisma.itinerary.findUnique({
				where: { id: booking.itineraryId },
				select: { status: true },
			});
			if (itinerary !== null && itinerary.status === "CANCELLED") {
				throw conflict("The itinerary for this booking has been cancelled");
			}
		}

		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { lastName: true },
		});
		if (user === null) {
			throw notFound("User not found");
		}

		await cancelFlightReservation(booking.id, user.lastName);

		return jsonMessage("Flight booking cancelled successfully", 200);
	}
);
