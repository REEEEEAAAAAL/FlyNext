/**
 * `GET    /api/user/hotel-bookings/[bookingId]` — booking detail.
 * `DELETE /api/user/hotel-bookings/[bookingId]` — cancel the booking.
 *
 * Response contract, relied on by
 * `app/user/hotel-bookings/[bookingId]/page.tsx`:
 * - `200 { booking: HotelBookingDetail }` — flat `checkIn`/`checkOut`/`price` and
 *   a nested `room: { type, amenities }`, unlike the list endpoint's `period`
 *   envelope. Both shapes are load-bearing.
 * - `200 { message: "Hotel booking cancelled successfully" }`
 * - `401`, `403`, `404`, `409 { error: string }`
 *
 * Both relations are nullable (`onDelete: SetNull`), so the response degrades to a
 * placeholder when the hotel or the room type has been deleted rather than
 * throwing, and the permission check tolerates a missing hotel owner. Cancelling
 * runs through the shared helper, which marks the reservation cancelled, returns
 * the nights and adjusts the itinerary price in one transaction, exactly once.
 */

import { requireAuth } from "@/lib/api/auth";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage, jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { cancelHotelReservation } from "@/lib/reservations";
import type { HotelBookingDetail } from "@/types";

/** Shown when the hotel record has been deleted. */
const UNKNOWN_HOTEL = "Hotel no longer available";

export const GET = withRoute<{ bookingId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	const { bookingId: rawBookingId } = await context.params;
	const bookingId = parseRouteId(rawBookingId, "bookingId");

	const booking = await prisma.hotelReservation.findFirst({
		where: { id: bookingId, userId },
		select: {
			id: true,
			status: true,
			checkIn: true,
			checkOut: true,
			price: true,
			createdAt: true,
			hotel: { select: { name: true, address: true, location: true } },
			roomType: { select: { name: true, amenities: true } },
		},
	});
	if (booking === null) {
		throw notFound("Booking not found");
	}

	const payload: HotelBookingDetail = {
		id: booking.id,
		status: booking.status,
		checkIn: booking.checkIn,
		checkOut: booking.checkOut,
		price: booking.price,
		hotel: {
			name: booking.hotel?.name ?? UNKNOWN_HOTEL,
			address: booking.hotel?.address ?? "",
			location: booking.hotel?.location ?? "",
		},
		room: {
			type: booking.roomType?.name ?? null,
			amenities: booking.roomType?.amenities ?? null,
		},
		createdAt: booking.createdAt,
	};

	return jsonOk({ booking: payload });
});

export const DELETE = withRoute<{ bookingId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		enforceRateLimit(request, "bookingWrite");
		const { bookingId: rawBookingId } = await context.params;
		const bookingId = parseRouteId(rawBookingId, "bookingId");

		const hotelReservation = await prisma.hotelReservation.findFirst({
			where: { id: bookingId, userId },
			include: { hotel: { select: { ownerId: true } } },
		});
		if (hotelReservation === null) {
			throw notFound("Hotel booking not found");
		}

		// The booker or the hotel's owner may cancel.
		const isBooker = hotelReservation.userId === userId;
		const isHotelOwner = hotelReservation.hotel?.ownerId === userId;
		if (!isBooker && !isHotelOwner) {
			throw forbidden("You do not have permission to cancel this booking");
		}

		// An itinerary that has been cancelled has already settled its total.
		if (hotelReservation.itineraryId !== null) {
			const itinerary = await prisma.itinerary.findUnique({
				where: { id: hotelReservation.itineraryId },
				select: { status: true },
			});
			if (itinerary !== null && itinerary.status === "CANCELLED") {
				throw conflict("The itinerary for this booking has been cancelled");
			}
		}

		await cancelHotelReservation(hotelReservation.id);

		return jsonMessage("Hotel booking cancelled successfully", 200);
	}
);
