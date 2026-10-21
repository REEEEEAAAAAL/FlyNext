import { Prisma } from "@prisma/client";
import { conflict } from "./api/errors";
import { addDays, eachNight } from "./api/validation";

type Reader = Pick<Prisma.TransactionClient, "roomAvailabilityRecord" | "hotelReservation">;

type AvailabilityRecord = { date: Date; availability: number };
type ActiveStay = { checkIn: Date; checkOut: Date };

export function calculateNightlyAvailability(
	room: { id: number; currentAvailability: number },
	dates: readonly Date[],
	records: readonly AvailabilityRecord[],
	bookings: readonly ActiveStay[]
) {
	const stored = new Map(records.map(row => [row.date.getTime(), row.availability]));
	return dates.map(date => {
		const occupied = bookings.filter(row => row.checkIn <= date && row.checkOut > date).length;
		const derived = Math.max(0, room.currentAvailability - occupied);
		return { roomTypeId: room.id, date, availability: Math.max(0, Math.min(derived, stored.get(date.getTime()) ?? derived)) };
	});
}

export function assertDateAligned(date: Date): void {
	if (!Number.isFinite(date.getTime()) || date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) {
		throw conflict("Historical hotel dates require review before inventory can be changed");
	}
}

export async function nightlyAvailability(db: Reader, room: { id: number; currentAvailability: number }, dates: readonly Date[]) {
	if (!dates.length) return [];
	for (const date of dates) assertDateAligned(date);
	const start = new Date(Math.min(...dates.map(date => date.getTime())));
	const end = addDays(new Date(Math.max(...dates.map(date => date.getTime()))), 1);
	// Include adjacent days so shifted legacy midnights cannot silently disappear.
	const lower = addDays(start, -1);
	const upper = addDays(end, 1);
	const [records, bookings] = await Promise.all([
		db.roomAvailabilityRecord.findMany({ where: { roomTypeId: room.id, date: { gte: lower, lt: upper } }, select: { date: true, availability: true } }),
		db.hotelReservation.findMany({ where: { roomTypeId: room.id, status: { not: "CANCELLED" }, checkIn: { lt: upper }, checkOut: { gt: lower } }, select: { checkIn: true, checkOut: true } }),
	]);
	for (const row of records) assertDateAligned(row.date);
	for (const row of bookings) { assertDateAligned(row.checkIn); assertDateAligned(row.checkOut); }
	return calculateNightlyAvailability(room, dates, records, bookings);
}

export async function materializeStay(tx: Prisma.TransactionClient, room: { id: number; currentAvailability: number }, checkIn: Date, checkOut: Date) {
	const rows = await nightlyAvailability(tx, room, eachNight(checkIn, checkOut));
	await tx.roomAvailabilityRecord.createMany({ data: rows, skipDuplicates: true });
	return rows;
}

export async function materializeRoomHorizons(tx: Prisma.TransactionClient, roomTypeIds: readonly number[], dates: readonly Date[]) {
	if (!roomTypeIds.length || !dates.length) return { count: 0 };
	for (const date of dates) assertDateAligned(date);
	// Lock in a stable order and read capacity after concurrent edits commit.
	const rooms = await tx.$queryRaw<{ id: number; currentAvailability: number }[]>`
		SELECT id, "currentAvailability" FROM "RoomType"
		WHERE id IN (${Prisma.join([...roomTypeIds])}) ORDER BY id FOR UPDATE`;
	const lower = addDays(new Date(Math.min(...dates.map(date => date.getTime()))), -1);
	const upper = addDays(new Date(Math.max(...dates.map(date => date.getTime()))), 2);
	const ids = rooms.map(room => room.id);
	const [records, bookings] = await Promise.all([
		tx.roomAvailabilityRecord.findMany({ where: { roomTypeId: { in: ids }, date: { gte: lower, lt: upper } }, select: { roomTypeId: true, date: true, availability: true } }),
		tx.hotelReservation.findMany({ where: { roomTypeId: { in: ids }, status: { not: "CANCELLED" }, checkIn: { lt: upper }, checkOut: { gt: lower } }, select: { roomTypeId: true, checkIn: true, checkOut: true } }),
	]);
	for (const row of records) assertDateAligned(row.date);
	for (const row of bookings) { assertDateAligned(row.checkIn); assertDateAligned(row.checkOut); }
	const rows = rooms.flatMap(room => calculateNightlyAvailability(room, dates, records.filter(row => row.roomTypeId === room.id), bookings.filter(row => row.roomTypeId === room.id)));
	return tx.roomAvailabilityRecord.createMany({ data: rows, skipDuplicates: true });
}
