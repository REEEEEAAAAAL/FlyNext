/**
 * `DELETE /api/itineraries/[itineraryId]/hotels` — cancel the stay in an itinerary.
 *
 * Response contract, relied on by `app/itineraries/[itineraryId]/page.tsx`:
 * - `200 { message: "Hotel booking cancelled successfully" }`
 * - `401`, `403`, `404 { error: string }`
 * - `409 { error: string }` — the itinerary is already cancelled
 *
 * The stay may only be released while its itinerary is live: cancelling it after
 * the itinerary has been settled would decrement a total that has already been
 * adjusted, and would notify the traveller about a booking that was released
 * earlier.
 */

import { requireAuth } from "@/lib/api/auth";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { notify } from "@/lib/api/notify";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { cancelHotelReservation } from "@/lib/reservations";

export const DELETE = withRoute<{ itineraryId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");
		// Next.js 15 hands `params` over as a promise.
		const { itineraryId: rawItineraryId } = await context.params;
		const itineraryId = parseRouteId(rawItineraryId, "itineraryId");

		const itinerary = await prisma.itinerary.findFirst({
			where: { id: itineraryId, userId },
			select: { status: true },
		});
		if (itinerary === null) {
			throw forbidden("You do not have access to this itinerary");
		}
		if (itinerary.status === "CANCELLED") {
			throw conflict("This itinerary has already been cancelled");
		}

		const hotelReservation = await prisma.hotelReservation.findFirst({
			where: { itineraryId, userId },
			include: { hotel: { select: { ownerId: true, name: true } } },
		});
		if (hotelReservation === null) {
			throw notFound("Hotel booking not found");
		}

		// The booker or the hotel's owner may cancel. `hotel` is nullable
		// (`onDelete: SetNull`), so the owner test tolerates a deleted hotel.
		const isBooker = hotelReservation.userId === userId;
		const isHotelOwner = hotelReservation.hotel?.ownerId === userId;
		if (!isBooker && !isHotelOwner) {
			throw forbidden("You do not have permission to cancel this booking");
		}

		const cancelled = await cancelHotelReservation(hotelReservation.id);

		if (cancelled) {
			// Already committed; a notification failure must not fail the request.
			await notify({
				event: "itinerary-hotel-cancelled",
				userId: hotelReservation.userId,
				content: isHotelOwner
					? `Your hotel booking for "${hotelReservation.hotel?.name ?? "the hotel"}" has been cancelled by the hotel owner.`
					: `Your hotel booking for "${hotelReservation.hotel?.name ?? "the hotel"}" has been cancelled.`,
			});
		}

		return jsonMessage("Hotel booking cancelled successfully", 200);
	}
);
