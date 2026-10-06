/**
 * `GET    /api/itineraries/[itineraryId]/flights` — verify the flight's status.
 * `DELETE /api/itineraries/[itineraryId]/flights` — cancel the flight booking.
 *
 * Response contract, relied on by `app/itineraries/[itineraryId]/page.tsx`:
 * - `200 { message: "Flight is on schedule" }`
 * - `200 { message: "Flight booking cancelled successfully" }`
 * - `403`, `404 { error: string }` / `{ message: string }`
 * - `409 { error: string }` — the itinerary is already cancelled
 * - `502 { error: string }` when AFS fails, or when the flight is not on schedule
 *
 * A leg may only be released while its itinerary is live. Once the itinerary has
 * been cancelled its total has already been settled, and cancelling a leg after
 * that would decrement the total a second time — past zero — and notify the
 * traveller about a booking that was already released.
 */

import { requireAuth } from "@/lib/api/auth";
import { badGateway, conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { verifyFlight } from "@/lib/afs-client";
import { prisma } from "@/lib/prisma";
import { cancelFlightReservation } from "@/lib/reservations";

/**
 * Load the caller's itinerary with its flight reservation's identifier.
 *
 * The AFS reference is part of the same projection: fetching it separately would
 * add a round-trip and turn a concurrent delete into Prisma's generic
 * `P2025 → 404 "Resource not found"` instead of the message the client expects.
 */
async function loadFlightReservation(itineraryId: number, userId: number) {
	const itinerary = await prisma.itinerary.findFirst({
		where: { id: itineraryId, userId },
		select: {
			status: true,
			flight: { select: { id: true, status: true, afsBookingId: true } },
		},
	});
	if (itinerary === null) {
		throw forbidden("You do not have access to this itinerary");
	}
	if (itinerary.flight === null) {
		throw notFound("Flight reservation not found");
	}
	return { itineraryStatus: itinerary.status, flight: itinerary.flight };
}

export const GET = withRoute<{ itineraryId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	const { itineraryId: rawItineraryId } = await context.params;
	const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

	const { flight } = await loadFlightReservation(itineraryId, userId);

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { lastName: true },
	});
	if (user === null) {
		throw notFound("User not found");
	}

	const verification = await verifyFlight(flight.afsBookingId, user.lastName);

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

	// 502: the client treats this branch as a failure and shows the message.
	throw badGateway(`Flight is ${firstLegStatus ?? verification.status}`);
});

export const DELETE = withRoute<{ itineraryId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");
		const { itineraryId: rawItineraryId } = await context.params;
		const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

		const { itineraryStatus, flight } = await loadFlightReservation(
			itineraryId,
			userId
		);

		if (itineraryStatus === "CANCELLED") {
			throw conflict("This itinerary has already been cancelled");
		}
		if (flight.status !== "CONFIRMED") {
			return jsonMessage("Flight booking is already cancelled", 200);
		}

		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { lastName: true },
		});
		if (user === null) {
			throw notFound("User not found");
		}

		await cancelFlightReservation(flight.id, user.lastName);

		return jsonMessage("Flight booking cancelled successfully", 200);
	}
);
