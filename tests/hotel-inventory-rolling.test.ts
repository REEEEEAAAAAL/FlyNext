import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as book, DELETE as cancel } from "@/app/api/hotels/book/route";
import { GET as search } from "@/app/api/hotels/route";
import { PUT as editRoom } from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { materializeRoomHorizons } from "@/lib/hotel-inventory";
import { availabilityHorizon, parseStayRange } from "@/lib/api/validation";
import { prisma as applicationDb, DEFAULT_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { disconnect, prisma, resetDatabase } from "#support/db";
import { createHotel, createRoomType, createUser } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(disconnect);

describe("future inventory without a new seed", () => {
	it.each([
		["2026-12-30", "2027-01-03"], ["2027-06-15", "2027-06-17"],
		["2027-12-31", "2028-01-02"], ["2028-02-28", "2028-03-01"],
	])("searches, books and cancels %s to %s with no stored nights", async (arrival, departure) => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(arrival + "T12:00:00Z"));
		const guest = await createUser();
		const hotel = await createHotel();
		const room = await createRoomType({ hotelId: hotel.id, availability: 1, nights: 0 });
		const token = tokenFor(guest.id);
		const body = { hotelId: hotel.id, roomTypeId: room.id, checkIn: arrival, checkOut: departure };
		for (let index = 0; index < 2; index++) {
			const response = await callRoute(search, { query: new URLSearchParams({checkIn: arrival, checkOut: departure}).toString() });
			expect(response.status).toBe(200);
			const result = await readJson<{ hotels: { roomTypes: {availableRooms: number}[] }[] }>(response);
			expect(result.hotels[0].roomTypes[0].availableRooms).toBe(1);
		}
		expect(await prisma.roomAvailabilityRecord.count()).toBe(0);
		const responses = await Promise.all(Array.from({length: 2}, () => callRoute(book, {method: "POST", token, json: body})));
		expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
		const winner = responses.find(response => response.status === 201);
		if (!winner) throw new Error("No booking succeeded");
		const { reservation } = await readJson<{reservation: {id: number}}>(winner);
		const nights = parseStayRange(arrival, departure).nights;
		expect(await prisma.roomAvailabilityRecord.count()).toBe(nights);
		for (let index = 0; index < 2; index++) expect((await callRoute(cancel, {method: "DELETE", token, query: "reservationId=" + reservation.id})).status).toBe(200);
		const rows = await prisma.roomAvailabilityRecord.findMany();
		expect(rows).toHaveLength(nights);
		expect(rows.every(row => row.availability === 1)).toBe(true);
	}, 90_000);

	it("reference backfill counts active bookings, preserves existing rows and remains idempotent", async () => {
		const owner = await createUser({IsHotelOwner: true});
		const guest = await createUser();
		const hotel = await createHotel({ownerId: owner.id});
		const room = await createRoomType({hotelId: hotel.id, availability: 3, nights: 0});
		const { start, days } = availabilityHorizon();
		const end = days[2];
		await prisma.hotelReservation.create({data:{userId:guest.id,hotelId:hotel.id,roomTypeId:room.id,checkIn:start,checkOut:end,price:200,status:"CONFIRMED"}});
		await prisma.hotelReservation.create({data:{userId:guest.id,hotelId:hotel.id,roomTypeId:room.id,checkIn:start,checkOut:end,price:200,status:"CANCELLED"}});
		await prisma.roomAvailabilityRecord.create({data:{roomTypeId:room.id,date:start,availability:1}});
		const fill = () => applicationDb.$transaction(tx => materializeRoomHorizons(tx, [room.id], days), DEFAULT_TRANSACTION_OPTIONS);
		expect((await fill()).count).toBe(days.length - 1);
		expect((await fill()).count).toBe(0);
		const rows = await prisma.roomAvailabilityRecord.findMany({orderBy:{date:"asc"}});
		expect(rows.slice(0,3).map(row => row.availability)).toEqual([1,2,3]);
		expect(await prisma.hotelReservation.count()).toBe(2);
		const data = new FormData(); data.set("currentAvailability", "0");
		const response = await callRoute(editRoom,{method:"PUT",token:tokenFor(owner.id),params:{hotelId:String(hotel.id),roomTypeId:String(room.id)},formData:data});
		expect(response.status).toBe(409);
		expect((await prisma.roomType.findUniqueOrThrow({where:{id:room.id}})).currentAvailability).toBe(3);
	}, 90_000);
	it("serializes reference backfill with different guests competing for missing nights", async () => {
		const first = await createUser();
		const second = await createUser();
		const hotel = await createHotel();
		const room = await createRoomType({hotelId:hotel.id,availability:1,nights:0});
		const {start, days} = availabilityHorizon();
		const body = {hotelId:hotel.id,roomTypeId:room.id,checkIn:start.toISOString().slice(0,10),checkOut:days[2].toISOString().slice(0,10)};
		const [seeded, a, b] = await Promise.all([
			applicationDb.$transaction(tx => materializeRoomHorizons(tx,[room.id],days),DEFAULT_TRANSACTION_OPTIONS),
			callRoute(book,{method:"POST",token:tokenFor(first.id),json:body}),
			callRoute(book,{method:"POST",token:tokenFor(second.id),json:body}),
		]);
		expect(seeded.count).toBeGreaterThanOrEqual(days.length - 2);
		expect([a.status,b.status].sort()).toEqual([201,409]);
		const rows = await prisma.roomAvailabilityRecord.findMany({orderBy:{date:"asc"}});
		expect(rows).toHaveLength(days.length);
		expect(rows.slice(0,3).map(row => row.availability)).toEqual([0,0,1]);
		expect(await prisma.hotelReservation.count()).toBe(1);
	},90_000);

});
