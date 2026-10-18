/**
 * `POST   /api/hotels/book` — book a room type for a date range.
 * `DELETE /api/hotels/book?reservationId=` — cancel a reservation.
 *
 * Response contract, relied on by `app/hotels/page.tsx` (booking),
 * `app/hotels/[hotelId]/room-types/[roomTypeId]/edit/page.tsx` (owner-side
 * cancellation) and `app/user/hotel-bookings/[bookingId]/page.tsx`:
 * - `201 { message: "Hotel reservation created successfully.", reservation: { id, … } }`
 *   — the client reads `data.reservation.id`
 * - `200 { message: "Hotel booking cancelled successfully" }`
 * - `400`, `401`, `403`, `404`, `409`, `429 { error: string }`
 *
 * Availability is claimed per night by a conditional decrement inside one
 * transaction, so two concurrent requests for the last room cannot both succeed:
 * the loser's `updateMany` matches no row and the whole transaction rolls back
 * with `409`. Cancellation is the exact inverse, applied to the same rows.
 *
 * Both verbs are rate limited by user, which also absorbs a double-submitted
 * booking form before it reaches the transaction.
 */

import { requireAuth } from "@/lib/api/auth";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { notify } from "@/lib/api/notify";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonMessage } from "@/lib/api/response";
import {
	eachNight,
	isWithinAvailabilityHorizon,
	parseRouteId,
	parseStayRange,
	readId,
	readString,
} from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { idempotentWrite } from "@/lib/api/idempotency";
import { lockTraveller, lockRoom, money } from "@/lib/booking-locks";
import { materializeStay } from "@/lib/hotel-inventory";
import { cancelHotelReservation } from "@/lib/reservations";

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "bookingWrite");

	const body = (await request.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw badRequest("Request body must be a JSON object");
	}

	// `readId` accepts `5` and `"5"` alike; anything that is not a positive
	// integer is a `400`.
	const hotelId = readId(body, "hotelId");
	const roomTypeId = readId(body, "roomTypeId");
	const checkInRaw = readString(body, "checkIn");
	const checkOutRaw = readString(body, "checkOut");

	if (
		hotelId === undefined ||
		roomTypeId === undefined ||
		checkInRaw === undefined ||
		checkOutRaw === undefined
	) {
		throw badRequest("Missing required fields");
	}

	const { checkIn, checkOut, nights } = parseStayRange(checkInRaw, checkOutRaw);

	const dates = eachNight(checkIn, checkOut);

	/*
	 * The horizon test is the only thing that may reject a stay as unsupported.
	 *
	 * It compares calendar days rather than timestamps, so a stay is judged by the
	 * dates the guest picked and not by the reader's time zone, and the window is a
	 * fixed 60 nights from today rather than "two months" — which, from the 31st of
	 * a month, is a shorter window than from the 1st.
	 */

	return idempotentWrite(request, userId, "hotel-book", body, async tx => {
	const unsupported = dates.some((night) => !isWithinAvailabilityHorizon(night));
	if (unsupported) {
		throw badRequest("The selected date is not supported for booking.");
	}

		await lockTraveller(tx, userId);
		await lockRoom(tx, roomTypeId);
		const roomType = await tx.roomType.findUnique({ where: { id: roomTypeId } });
		if (!roomType || roomType.hotelId !== hotelId) throw notFound("Room type not found");
		const hotel = await tx.hotel.findUnique({ where: { id: hotelId }, select: { ownerId: true, name: true } });
		const available = await materializeStay(tx, roomType, checkIn, checkOut);
		if (available.some(row => row.availability < 1)) throw conflict("No rooms available for the selected booking period.");
		const claimed = await tx.roomAvailabilityRecord.updateMany({
			where: {
				roomTypeId,
				date: { in: dates },
				availability: { gt: 0 },
			},
			data: { availability: { decrement: 1 } },
		});
		if (claimed.count !== dates.length) {
			throw conflict("No rooms available for the selected booking period.");
		}

		const created = await tx.hotelReservation.create({
			data: {
				userId,
				hotelId,
				roomTypeId,
				checkIn,
				checkOut,
				price: money(money(roomType.pricePerNight) * nights),
				status: "CONFIRMED",
			},
		});

		if (hotel !== null && hotel.ownerId !== null) {
			await tx.notification.create({
				data: {
					userId: hotel.ownerId,
					content: `A new booking for your hotel "${hotel.name}" has been made.`,
				},
			});
		}

		return { status: 201, body: { message: "Hotel reservation created successfully.", reservation: created } };
	});
});

export const DELETE = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "bookingWrite");

	const { searchParams } = new URL(request.url);
	const rawReservationId = searchParams.get("reservationId");
	if (rawReservationId === null) {
		throw badRequest("Missing reservationId");
	}
	const reservationId = parseRouteId(rawReservationId, "reservationId");

	const reservation = await prisma.hotelReservation.findUnique({
		where: { id: reservationId },
		include: { hotel: { select: { ownerId: true, name: true } } },
	});
	if (reservation === null) {
		throw notFound("Hotel booking not found");
	}

	// Either the booker or the hotel's owner may cancel.
	const isBooker = reservation.userId === userId;
	const isHotelOwner = reservation.hotel?.ownerId === userId;
	if (!isBooker && !isHotelOwner) {
		throw forbidden("You do not have permission to cancel this booking");
	}

	const hotelName = reservation.hotel?.name ?? "the hotel";

	// Status transition, availability release and itinerary adjustment happen in
	// one transaction inside the shared helper; it is idempotent, so a repeated
	// call does not release the same nights twice.
	const cancelled = await cancelHotelReservation(reservationId);

	if (cancelled) {
		// The cancellation has already committed; a notification failure must not
		// turn it into an error response.
		await notify({
			event: "hotel-booking-cancelled",
			userId: reservation.userId,
			content: isHotelOwner
				? `Your hotel booking for "${hotelName}" has been cancelled by the hotel owner.`
				: `Your hotel booking for "${hotelName}" has been cancelled.`,
		});
	}

	return jsonMessage("Hotel booking cancelled successfully", 200);
});
