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
import { jsonCreated, jsonMessage } from "@/lib/api/response";
import {
	eachNight,
	isWithinAvailabilityHorizon,
	parseRouteId,
	parseStayRange,
	readId,
	readString,
} from "@/lib/api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import { cancelHotelReservation } from "@/lib/reservations";

/** Prisma client bound to an open transaction. */
type TransactionClient = Parameters<
	Parameters<typeof prisma.$transaction>[0]
>[0];

/**
 * Give every night of a stay an availability row, when the calendar has none.
 *
 * The calendar is meant to be materialised by whoever creates the room type, and
 * `POST .../room-types` does exactly that. This is the safety net for the ways
 * that materialisation can be missing underneath a stay that is otherwise
 * perfectly bookable — a room type seeded straight from SQL, a calendar written
 * before the horizon was widened, a database restored from a stale dump — each of
 * which otherwise reached the guest as
 * `"The selected date is not supported for booking."` on a hotel the site was
 * actively advertising.
 *
 * Only the nights that are genuinely absent are inserted, and `skipDuplicates`
 * treats a concurrent booking materialising the same night as an ignorable
 * conflict rather than a failed request.
 *
 * Callers must have established that the whole stay is inside the booking
 * horizon; the range test lives in `isWithinAvailabilityHorizon`, so this only
 * ever fills in dates the site promised it would sell.
 */
async function materializeMissingNights(
	tx: TransactionClient,
	roomTypeId: number,
	nights: readonly Date[],
	capacity: number
): Promise<void> {
	const existing = await tx.roomAvailabilityRecord.findMany({
		where: { roomTypeId, date: { in: [...nights] } },
		select: { date: true },
	});
	const present = new Set(existing.map((row) => row.date.getTime()));
	const missing = nights.filter((night) => !present.has(night.getTime()));
	if (missing.length === 0) {
		return;
	}

	await tx.roomAvailabilityRecord.createMany({
		data: missing.map((date) => ({ roomTypeId, date, availability: capacity })),
		skipDuplicates: true,
	});
}

/**
 * The capacity a newly materialised night should start at.
 *
 * `RoomAvailabilityRecord.availability` is the number of rooms left on one night
 * and `RoomType.currentAvailability` is the figure the owner configured, so the
 * configured value is right when nothing is on the calendar yet. Once a calendar
 * exists, its latest night is the better estimate — it carries the owner's most
 * recent capacity change as well as any bookings against that night, whereas a
 * booking never updates `currentAvailability`. The smaller of the two is taken so
 * that a materialised night can never advertise more rooms than either figure
 * allows.
 */
function startingCapacity(
	latestNight: number | null,
	currentAvailability: number
): number {
	if (latestNight === null) {
		return currentAvailability;
	}
	return Math.min(latestNight, currentAvailability);
}

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");

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

	// The room type must exist and belong to the hotel being booked.
	const roomType = await prisma.roomType.findUnique({
		where: { id: roomTypeId },
		select: {
			id: true,
			hotelId: true,
			pricePerNight: true,
			currentAvailability: true,
		},
	});
	if (roomType === null || roomType.hotelId !== hotelId) {
		throw notFound("Room type not found");
	}

	const dates = eachNight(checkIn, checkOut);

	/*
	 * The horizon test is the only thing that may reject a stay as unsupported.
	 *
	 * It compares calendar days rather than timestamps, so a stay is judged by the
	 * dates the guest picked and not by the reader's time zone, and the window is a
	 * fixed 60 nights from today rather than "two months" — which, from the 31st of
	 * a month, is a shorter window than from the 1st.
	 */
	const unsupported = dates.some((night) => !isWithinAvailabilityHorizon(night));
	if (unsupported) {
		throw badRequest("The selected date is not supported for booking.");
	}

	const hotel = await prisma.hotel.findUnique({
		where: { id: hotelId },
		select: { ownerId: true, name: true },
	});

	/*
	 * One transaction claims every night at once.
	 *
	 * The claim is a single conditional `updateMany`: it decrements exactly the
	 * rows that still have a room left, and compares how many it touched against
	 * how many nights the stay spans. A short count means at least one night was
	 * taken by a concurrent request, and because the comparison happens inside the
	 * transaction the whole claim rolls back — so a partially booked stay can
	 * never persist, and one statement is enough for the common case instead of
	 * two round-trips per night.
	 *
	 * Any night the calendar has no row for is materialised first, from the room
	 * type's own capacity. Filling them in before the claim means the guest gets
	 * the same "no rooms left" answer for a night that was never opened as for one
	 * that sold out, instead of being told their dates are unsupported on a date
	 * range the site offers.
	 *
	 * The owner's notification is part of the same transaction: a booking that
	 * committed while its notification failed would report an error to the client,
	 * which would invite a retry that books and decrements a second time.
	 */
	const reservation = await prisma.$transaction(async (tx) => {
		// The latest night already on the calendar is the best available proxy for
		// the owner's current capacity, and `null` when there is no calendar at all.
		const latest = await tx.roomAvailabilityRecord.findFirst({
			where: { roomTypeId, date: { lte: checkOut } },
			orderBy: { date: "desc" },
			select: { availability: true },
		});
		await materializeMissingNights(
			tx,
			roomTypeId,
			dates,
			startingCapacity(latest?.availability ?? null, roomType.currentAvailability)
		);

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
				price: roomType.pricePerNight * nights,
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

		return created;
	}, DEFAULT_TRANSACTION_OPTIONS);

	return jsonCreated({
		message: "Hotel reservation created successfully.",
		reservation,
	});
});

export const DELETE = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");

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
