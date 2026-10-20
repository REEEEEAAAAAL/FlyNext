import type { PrismaClient } from "@prisma/client";
import { searchFlights, isAfsOffline } from "../lib/afs-client";
import { createFlightReservation } from "../lib/reservations";
import { prisma as flightDb } from "../lib/prisma";
import { lockRoom, lockTraveller, money } from "../lib/booking-locks";
import { eachNight, parseStayRange } from "../lib/api/validation";
import { materializeStay } from "../lib/hotel-inventory";

export async function seedDockerJourney(db: PrismaClient): Promise<void> {
	if (!isAfsOffline()) throw new Error("Docker demo journey requires the built-in AFS.");
	const user = await db.user.findUniqueOrThrow({ where: { email: "user1@example.com" } });
	const room = await db.roomType.findFirstOrThrow({ where: { hotel: { location: { contains: "Toronto" } } }, orderBy: { id: "asc" } });
	const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
	const checkIn = day(3), checkOut = day(5);
	try {
		const groups = await searchFlights({ origin: "YYZ", destination: "LHR", date: checkIn });
		const flights = groups[0]?.flights;
		if (!flights?.length) throw new Error("Built-in demo flight search returned no flights.");
		const flight = await createFlightReservation({ email: user.email, firstName: user.firstName,
			lastName: user.lastName, passportNumber: "DEMO-PASSENGER", flightIds: flights.map(row => row.id) }, user.id, { returnLegCount: 0 });
		const { checkIn: start, checkOut: end, nights } = parseStayRange(checkIn, checkOut);
		await db.$transaction(async tx => {
			await lockTraveller(tx, user.id);
			await lockRoom(tx, room.id);
			await materializeStay(tx, room, start, end);
			const claimed = await tx.roomAvailabilityRecord.updateMany({ where: { roomTypeId: room.id,
				date: { in: eachNight(start, end) }, availability: { gt: 0 } }, data: { availability: { decrement: 1 } } });
			if (claimed.count !== nights) throw new Error("Demo journey inventory is unavailable.");
			const price = money(room.pricePerNight * nights);
			const bookedFlight = await tx.flightReservation.findUniqueOrThrow({ where: { id: flight.reservationId } });
			const trip = await tx.itinerary.create({ data: { userId: user.id, totalPrice: money(price + bookedFlight.price),
				status: "DRAFT", cardNumber: "", cardExpiry: "" } });
			await tx.hotelReservation.create({ data: { userId: user.id, hotelId: room.hotelId, roomTypeId: room.id,
				checkIn: start, checkOut: end, price, status: "CONFIRMED", itineraryId: trip.id } });
			await tx.flightReservation.update({ where: { id: flight.reservationId }, data: { itineraryId: trip.id } });
		});
		console.log("Docker demo journey created: one flight, one hotel stay and one draft itinerary.");
	} finally { await flightDb.$disconnect(); }
}
