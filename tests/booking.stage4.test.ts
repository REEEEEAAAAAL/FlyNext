import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as book } from "@/app/api/hotels/book/route";
import { GET as search } from "@/app/api/hotels/route";
import { GET as calendar } from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { cancelHotelReservation, claimHotelCancellation, releaseStayAvailability } from "@/lib/reservations";
import { prisma as applicationDb, DEFAULT_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { addDays, createHotel, createRoomType, createUser, tomorrow, toDateParam } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";
import { repairDate } from "@/lib/hotel-date-repair";

beforeEach(resetDatabase);
afterAll(disconnect);

async function fixture() {
	const user = await createUser();
	const hotel = await createHotel({});
	const room = await createRoomType({ hotelId: hotel.id, availability: 1 });
	const start = tomorrow();
	const body = { hotelId: hotel.id, roomTypeId: room.id, checkIn: toDateParam(start), checkOut: toDateParam(addDays(start, 3)) };
	return { user, hotel, room, start, body, token: tokenFor(user.id) };
}

describe("stage 4 hotel regressions", () => {
	it("unrelated expired legacy rows do not block current read-only search or calendar", async () => {
		const f = await fixture();
		const ancient = new Date("2020-01-01T16:00:00Z");
		await prisma.roomAvailabilityRecord.create({data:{roomTypeId:f.room.id,date:ancient,availability:1}});
		await prisma.hotelReservation.create({data:{userId:f.user.id,hotelId:f.hotel.id,roomTypeId:f.room.id,checkIn:ancient,checkOut:new Date("2020-01-02T16:00:00Z"),price:1}});
		const before = await prisma.roomAvailabilityRecord.count();
		expect((await callRoute(search,{query:`checkIn=${f.body.checkIn}&checkOut=${f.body.checkOut}`})).status).toBe(200);
		expect((await callRoute(calendar,{params:{hotelId:String(f.hotel.id),roomTypeId:String(f.room.id)}})).status).toBe(200);
		expect(await prisma.roomAvailabilityRecord.count()).toBe(before);
	},60_000);
	it("repaired legacy nights support reads, last-room booking and exactly-once cancellation", async () => {
		const f=await fixture();
		const legacy=new Date(f.start.getTime()-8*3600000);
		await prisma.roomAvailabilityRecord.deleteMany({where:{roomTypeId:f.room.id}});
		const row=await prisma.roomAvailabilityRecord.create({data:{roomTypeId:f.room.id,date:legacy,availability:1}});
		expect((await callRoute(search,{query:`checkIn=${f.body.checkIn}&checkOut=${f.body.checkOut}`})).status).toBe(409);
		await prisma.roomAvailabilityRecord.update({where:{id:row.id},data:{date:new Date(repairDate(legacy.toISOString(),"Asia/Shanghai"))}});
		expect((await callRoute(search,{query:`checkIn=${f.body.checkIn}&checkOut=${f.body.checkOut}`})).status).toBe(200);
		const response=await callRoute(book,{method:"POST",token:f.token,json:f.body});
		expect(response.status).toBe(201);
		const {reservation}=await readJson<{reservation:{id:number}}>(response);
		expect((await callRoute(book,{method:"POST",token:f.token,json:f.body})).status).toBe(409);
		await cancelHotelReservation(reservation.id);await cancelHotelReservation(reservation.id);
		expect((await prisma.roomAvailabilityRecord.findMany({where:{roomTypeId:f.room.id}})).every(r=>r.availability===1)).toBe(true);
	},60_000);
	it.each(["UTC", "Asia/Shanghai", "America/Toronto"])("releases exactly the stored nights with PostgreSQL session timezone %s", async zone => {
		const f = await fixture();
		const booked = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		const { reservation } = await readJson<{ reservation: { id: number } }>(booked);
		await applicationDb.$transaction(async tx => {
			await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
			expect(await claimHotelCancellation(tx, reservation.id)).toBe(true);
			await releaseStayAvailability(tx, f.room.id, f.start, addDays(f.start, 3));
		}, DEFAULT_TRANSACTION_OPTIONS);
		const rows = await prisma.roomAvailabilityRecord.findMany({ where: { roomTypeId: f.room.id } });
		expect(rows.every(row => row.availability === 1)).toBe(true);
	}, 60_000);
	it("quotes and books the same cent-rounded nightly rate without rewriting historical rates", async () => {
		const f = await fixture();
		await prisma.roomType.update({ where: { id: f.room.id }, data: { pricePerNight: 0.105 } });
		const result = await callRoute(search, { query: `checkIn=${f.body.checkIn}&checkOut=${f.body.checkOut}` });
		const data = await readJson<{ hotels: { roomTypes: { pricePerNight: number; stayTotal: number; nights: number }[] }[] }>(result);
		expect(data.hotels[0].roomTypes[0]).toMatchObject({ pricePerNight: 0.11, stayTotal: 0.33, nights: 3 });
		const booked = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		expect((await readJson<{ reservation: { price: number } }>(booked)).reservation.price).toBe(0.33);
		expect((await prisma.roomType.findUniqueOrThrow({ where: { id: f.room.id } })).pricePerNight).toBe(0.105);
	}, 60_000);
	it("search uses the minimum across every stay night and GET never inserts inventory", async () => {
		const f = await fixture();
		await prisma.roomAvailabilityRecord.updateMany({ where: { roomTypeId: f.room.id, date: addDays(f.start, 1) }, data: { availability: 0 } });
		const result = await callRoute(search, { query: `checkIn=${f.body.checkIn}&checkOut=${f.body.checkOut}` });
		const data = await readJson<{ hotels: unknown[] }>(result);
		expect(data.hotels).toHaveLength(0);
		await prisma.roomAvailabilityRecord.deleteMany({ where: { roomTypeId: f.room.id } });
		const before = await prisma.roomAvailabilityRecord.count();
		const response = await callRoute(calendar, { params: { hotelId: String(f.hotel.id), roomTypeId: String(f.room.id) } });
		expect(response.status).toBe(200);
		expect(await prisma.roomAvailabilityRecord.count()).toBe(before);
	}, 60_000);

	it("replays the exact hotel result after a lost response and rejects a changed body", async () => {
		const f = await fixture();
		const missingKey = await callRoute(book, { method: "POST", token: f.token, json: f.body, headers: { "Idempotency-Key": "" } });
		expect(missingKey.status).toBe(400);
		const headers = { "Idempotency-Key": "hotel-lost-response" };
		const responses = await Promise.all([0, 1].map(() => callRoute(book, { method: "POST", token: f.token, json: f.body, headers })));
		expect(responses.map(r => r.status)).toEqual([201, 201]);
		expect(await readJson(responses[0])).toEqual(await readJson(responses[1]));
		expect(await prisma.hotelReservation.count()).toBe(1);
		const changed = await callRoute(book, { method: "POST", token: f.token, json: { ...f.body, checkOut: toDateParam(addDays(f.start, 2)) }, headers });
		expect(changed.status).toBe(409);
		const anotherUser = await createUser();
		const anotherRoom = await createRoomType({ hotelId: f.hotel.id, availability: 1 });
		const independent = await callRoute(book, { method: "POST", token: tokenFor(anotherUser.id), json: { ...f.body, roomTypeId: anotherRoom.id }, headers });
		expect(independent.status).toBe(201);
	}, 60_000);

	it("parallel duplicate cancellations restore all nights once", async () => {
		const f = await fixture();
		const response = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		const data = await readJson<{ reservation: { id: number } }>(response);
		await Promise.all([cancelHotelReservation(data.reservation.id), cancelHotelReservation(data.reservation.id)]);
		const rows = await prisma.roomAvailabilityRecord.findMany({ where: { roomTypeId: f.room.id } });
		expect(rows.every(row => row.availability === 1)).toBe(true);
	}, 60_000);

	it("derives a missing night from existing reservations and preserves ambiguous historical dates", async () => {
		const f = await fixture();
		const booked = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		expect(booked.status).toBe(201);
		await prisma.roomAvailabilityRecord.deleteMany({ where: { roomTypeId: f.room.id } });
		const retry = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		expect(retry.status).toBe(409);
		const historical = new Date(f.start); historical.setUTCHours(16);
		await prisma.roomAvailabilityRecord.create({ data: { roomTypeId: f.room.id, date: historical, availability: 1 } });
		const blocked = await callRoute(book, { method: "POST", token: f.token, json: f.body });
		expect(blocked.status).toBe(409);
		expect((await prisma.roomAvailabilityRecord.findFirstOrThrow()).date.getTime()).toBe(historical.getTime());
		expect(await prisma.hotelReservation.count()).toBe(1);
	}, 60_000);
});
