import type { Prisma } from "@prisma/client";
import { conflict } from "./api/errors";
import { eachNight } from "./api/validation";

type Reader = Pick<Prisma.TransactionClient, "roomAvailabilityRecord" | "hotelReservation">;

export function assertDateAligned(date: Date): void {
	if (date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) {
		throw conflict("Historical hotel dates require review before inventory can be changed");
	}
}

export async function nightlyAvailability(db: Reader, room: { id: number; currentAvailability: number }, dates: readonly Date[]) {
	if (!dates.length) return [];
	const [records, bookings] = await Promise.all([
		db.roomAvailabilityRecord.findMany({ where: { roomTypeId: room.id }, select: { date: true, availability: true } }),
		db.hotelReservation.findMany({ where: { roomTypeId: room.id, status: { not: "CANCELLED" } }, select: { checkIn: true, checkOut: true } }),
	]);
	for (const row of records) assertDateAligned(row.date);
	for (const row of bookings) { assertDateAligned(row.checkIn); assertDateAligned(row.checkOut); }
	const stored = new Map(records.map(row => [row.date.getTime(), row.availability]));
	return dates.map(date => {
		const occupied = bookings.filter(row => row.checkIn <= date && row.checkOut > date).length;
		const derived = Math.max(0, room.currentAvailability - occupied);
		return { roomTypeId: room.id, date, availability: Math.max(0, Math.min(derived, stored.get(date.getTime()) ?? derived)) };
	});
}

export async function materializeStay(tx: Prisma.TransactionClient, room: { id: number; currentAvailability: number }, checkIn: Date, checkOut: Date) {
	const rows = await nightlyAvailability(tx, room, eachNight(checkIn, checkOut));
	await tx.roomAvailabilityRecord.createMany({ data: rows, skipDuplicates: true });
	return rows;
}
