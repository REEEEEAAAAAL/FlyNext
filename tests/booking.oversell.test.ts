/**
 * Concurrency suite: the last room.
 *
 * `POST /api/hotels/book` decides whether a stay is available and takes it in the
 * same transaction, using a conditional `updateMany` whose affected-row count is
 * the proof that the nights were claimed. These cases fire genuinely simultaneous
 * requests at a room type with a single room left and assert that exactly one
 * succeeds — the defect this guards against is the classic check-then-act
 * oversell, where two requests both read "1 available" and both commit.
 *
 * The requests really do overlap: they are dispatched with `Promise.all` against
 * the same process, so the two transactions are open at the same time and the
 * second `updateMany` blocks on the first one's row lock. That is what makes the
 * suite meaningful — a sequential pair of requests would pass even against a
 * handler that reads availability and writes it back without a conditional
 * update.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bookHotel } from "@/app/api/hotels/book/route";
import { DELETE as cancelHotelBooking } from "@/app/api/hotels/book/route";
import { disconnect, prisma, resetDatabase } from "#support/db";
import {
  addDays,
  createHotel,
  createRoomType,
  createUser,
  tomorrow,
  toDateParam,
} from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

/** Build the JSON body the booking page sends. */
function bookingBody(options: {
  hotelId: number;
  roomTypeId: number;
  checkIn: Date;
  nights?: number;
}) {
  const checkOut = addDays(options.checkIn, options.nights ?? 1);
  return {
    hotelId: String(options.hotelId),
    roomTypeId: String(options.roomTypeId),
    checkIn: toDateParam(options.checkIn),
    checkOut: toDateParam(checkOut),
  };
}

describe("concurrent booking of the last room", () => {
  it("allows exactly one of two simultaneous requests and rejects the other with 409", async () => {
    const owner = await createUser({ IsHotelOwner: true });
    const guest = await createUser();

    const hotel = await createHotel({ ownerId: owner.id });
    // Exactly one room, so only one of the two requests can legitimately win.
    const roomType = await createRoomType({
      hotelId: hotel.id,
      availability: 1,
      pricePerNight: 100,
    });

    const checkIn = tomorrow();
    const body = bookingBody({ hotelId: hotel.id, roomTypeId: roomType.id, checkIn });
    const token = tokenFor(guest.id);

    const [first, second] = await Promise.all([
      callRoute(bookHotel, { method: "POST", token, json: body }),
      callRoute(bookHotel, { method: "POST", token, json: body }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const rejected = first.status === 409 ? first : second;
    const rejectedBody = await readJson<{ error: string }>(rejected);
    expect(rejectedBody.error).toMatch(/no rooms available/i);
  });

  it("leaves the room sold out and records a single reservation", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, availability: 1 });

    const checkIn = tomorrow();
    const body = bookingBody({ hotelId: hotel.id, roomTypeId: roomType.id, checkIn });
    const token = tokenFor(guest.id);

    await Promise.all([
      callRoute(bookHotel, { method: "POST", token, json: body }),
      callRoute(bookHotel, { method: "POST", token, json: body }),
    ]);

    // Availability is the shared resource: it must be exactly exhausted, never
    // negative, and there must be exactly one reservation behind the decrement.
    const availability = await prisma.roomAvailabilityRecord.findFirstOrThrow({
      where: { roomTypeId: roomType.id, date: checkIn },
      select: { availability: true },
    });
    expect(availability.availability).toBe(0);

    const reservations = await prisma.hotelReservation.count({
      where: { roomTypeId: roomType.id },
    });
    expect(reservations).toBe(1);
  });

  it("never lets availability fall below zero under a burst", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, availability: 3 });

    const checkIn = tomorrow();
    const body = bookingBody({ hotelId: hotel.id, roomTypeId: roomType.id, checkIn });
    const token = tokenFor(guest.id);

    // Six simultaneous requests for three rooms: three must win, three must lose.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        callRoute(bookHotel, { method: "POST", token, json: body })
      )
    );

    const created = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(3);
    expect(conflicts).toHaveLength(3);

    const availability = await prisma.roomAvailabilityRecord.findFirstOrThrow({
      where: { roomTypeId: roomType.id, date: checkIn },
      select: { availability: true },
    });
    expect(availability.availability).toBe(0);
  });

  it("rolls the whole stay back when any single night is sold out", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({
      hotelId: hotel.id,
      availability: 5,
      nights: 5,
    });

    const checkIn = tomorrow();

    // Sell out the second night of a three-night stay, leaving the first and
    // third free. A partially applied booking would leave the first night
    // decremented even though the booking failed.
    await prisma.roomAvailabilityRecord.updateMany({
      where: { roomTypeId: roomType.id, date: addDays(checkIn, 1) },
      data: { availability: 0 },
    });

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: bookingBody({
        hotelId: hotel.id,
        roomTypeId: roomType.id,
        checkIn,
        nights: 3,
      }),
    });

    expect(response.status).toBe(409);

    const nights = await prisma.roomAvailabilityRecord.findMany({
      where: { roomTypeId: roomType.id, date: { gte: checkIn } },
      orderBy: { date: "asc" },
      select: { date: true, availability: true },
    });
    expect(nights[0]?.availability).toBe(5);
    expect(nights[1]?.availability).toBe(0);
    expect(nights[2]?.availability).toBe(5);

    expect(await prisma.hotelReservation.count({ where: { roomTypeId: roomType.id } })).toBe(0);
  });

  it("restores a night when the booking is cancelled, so it can be sold again", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, availability: 1 });

    const checkIn = tomorrow();
    const body = bookingBody({ hotelId: hotel.id, roomTypeId: roomType.id, checkIn });
    const token = tokenFor(guest.id);

    const booking = await callRoute(bookHotel, { method: "POST", token, json: body });
    expect(booking.status).toBe(201);
    const { reservation } = await readJson<{ reservation: { id: number } }>(booking);

    // The room is gone, so another booking must be refused.
    const blocked = await callRoute(bookHotel, { method: "POST", token, json: body });
    expect(blocked.status).toBe(409);

    const cancelled = await callRoute(cancelHotelBooking, {
      method: "DELETE",
      token,
      query: `reservationId=${reservation.id}`,
    });
    expect(cancelled.status).toBe(200);

    const availability = await prisma.roomAvailabilityRecord.findFirstOrThrow({
      where: { roomTypeId: roomType.id, date: checkIn },
      select: { availability: true },
    });
    expect(availability.availability).toBe(1);

    // And the released room is genuinely bookable again.
    const rebooked = await callRoute(bookHotel, { method: "POST", token, json: body });
    expect(rebooked.status).toBe(201);
  });

  it("releases a night exactly once when a cancellation is repeated", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, availability: 2 });

    const checkIn = tomorrow();
    const token = tokenFor(guest.id);
    const booking = await callRoute(bookHotel, {
      method: "POST",
      token,
      json: bookingBody({ hotelId: hotel.id, roomTypeId: roomType.id, checkIn }),
    });
    const { reservation } = await readJson<{ reservation: { id: number } }>(booking);

    // Cancelling twice must not hand the same night back twice: that is how a
    // room type ends up advertising more rooms than it has.
    await callRoute(cancelHotelBooking, {
      method: "DELETE",
      token,
      query: `reservationId=${reservation.id}`,
    });
    await callRoute(cancelHotelBooking, {
      method: "DELETE",
      token,
      query: `reservationId=${reservation.id}`,
    });

    const availability = await prisma.roomAvailabilityRecord.findFirstOrThrow({
      where: { roomTypeId: roomType.id, date: checkIn },
      select: { availability: true },
    });
    expect(availability.availability).toBe(2);
  });

  it("keeps one availability row per room type per night", async () => {
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, nights: 3 });
    const checkIn = tomorrow();

    // The unique index is the guarantee the booking flow leans on: with two rows
    // for one night, a single booking would decrement only one of them and reads
    // would sum both.
    await expect(
      prisma.roomAvailabilityRecord.create({
        data: { roomTypeId: roomType.id, date: checkIn, availability: 9 },
      })
    ).rejects.toThrow();

    const rows = await prisma.roomAvailabilityRecord.count({
      where: { roomTypeId: roomType.id, date: checkIn },
    });
    expect(rows).toBe(1);
  });
});
