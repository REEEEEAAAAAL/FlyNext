/** List itineraries and atomically link confirmed reservations under traveller and row locks. */

import { requireAuth } from "@/lib/api/auth";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { parseJsonBody, readId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { idempotentWrite } from "@/lib/api/idempotency";
import { lockTraveller, money } from "@/lib/booking-locks";

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);

	const itineraries = await prisma.itinerary.findMany({
		where: { userId },
		select: {
			id: true,
			flight: true,
			hotel: {
				select: {
					hotel: {
						select: { name: true, address: true, location: true },
					},
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
		},
		orderBy: { bookingDate: "desc" },
	});

	return jsonOk({ itineraries });
});

export const POST = withRoute(async request => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "bookingWrite");
	const body = await parseJsonBody(request);
	const flightId = readId(body, "flightReservationId");
	const hotelId = readId(body, "hotelReservationId");
	if (flightId === undefined && hotelId === undefined) throw badRequest("No reservations provided for the itinerary");
	return idempotentWrite(request, userId, "itinerary-create", body, async tx => {
		await lockTraveller(tx, userId);
		if (flightId !== undefined) await tx.$queryRaw`SELECT id FROM "FlightReservation" WHERE id = ${flightId} FOR UPDATE`;
		if (hotelId !== undefined) await tx.$queryRaw`SELECT id FROM "HotelReservation" WHERE id = ${hotelId} FOR UPDATE`;
		const flight = flightId === undefined ? null : await tx.flightReservation.findUnique({ where: { id: flightId } });
		const hotel = hotelId === undefined ? null : await tx.hotelReservation.findUnique({ where: { id: hotelId } });
		for (const [id, row, label] of [[flightId, flight, "Flight"], [hotelId, hotel, "Hotel"]] as const) {
			if (id === undefined) continue;
			if (!row) throw notFound(`${label} reservation not found`);
			if (row.userId !== userId) throw forbidden(`Unauthorized ${label.toLowerCase()} reservation access`);
			if (row.status !== "CONFIRMED") throw conflict(`${label} reservation is cancelled`);
			if (row.itineraryId !== null) throw conflict(`${label} reservation already linked`);
		}
		if (flight?.cancellationPending) throw conflict("Flight cancellation is pending; retry cancellation before creating an itinerary");
		const itinerary = await tx.itinerary.create({ data: { userId, totalPrice: money((flight?.price ?? 0) + (hotel?.price ?? 0)), status: "DRAFT", cardNumber: "", cardExpiry: "" }, select: { id: true, status: true } });
		if (flight) await tx.flightReservation.update({ where: { id: flight.id }, data: { itineraryId: itinerary.id } });
		if (hotel) await tx.hotelReservation.update({ where: { id: hotel.id }, data: { itineraryId: itinerary.id } });
		await tx.notification.create({ data: { userId, content: `Your itinerary (ID: ${itinerary.id}) has been created successfully.` } });
		return { status: 201, body: { message: "Itinerary created successfully", reservations: { ...itinerary, flight: flight ? { id: flight.id } : false, hotel: hotel ? { id: hotel.id } : false } } };
	});
});
