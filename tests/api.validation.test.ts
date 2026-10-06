/**
 * Validation suite: input that must never reach the database.
 *
 * Every case here pairs a malformed request with an assertion that the endpoint
 * answered `400` (or the endpoint's documented client-error status) and that
 * nothing was written. The distinction matters: a handler that rejects bad input
 * after partially applying it is worse than one that accepts it, because the
 * caller has no way to tell.
 *
 * The cases cover the failure modes this API is most exposed to: `NaN` route
 * segments surfacing as `500`, an impossible calendar date silently rolling over
 * into a real one, a reversed stay range producing a free booking, a card
 * number that arrives as a JSON number, where `.length` is read before the type
 * is checked, and an id that arrives in the wrong JSON type — which the id
 * fields accept as a string or a number, and refuse in every other shape.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bookHotel } from "@/app/api/hotels/book/route";
import { POST as checkout } from "@/app/api/checkout/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getHotel } from "@/app/api/hotels/[hotelId]/route";
import { GET as getRoomType } from "@/app/api/hotels/[hotelId]/room-types/[roomTypeId]/route";
import { GET as getFlightBooking } from "@/app/api/user/flight-bookings/[bookingId]/route";
import { GET as listHotels } from "@/app/api/hotels/route";
import { POST as createItinerary } from "@/app/api/itineraries/route";
import { AVAILABILITY_HORIZON_DAYS } from "@/lib/api/validation";
import { disconnect, prisma, resetDatabase } from "#support/db";
import {
  addDays,
  atMidnight,
  createHotel,
  createHotelReservation,
  createItinerary as createItineraryRow,
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

describe("stay ranges", () => {
  it("rejects checkOut equal to checkIn", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const night = tomorrow();

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(night),
        checkOut: toDateParam(night),
      },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/checkOut must be after checkIn/i);
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("rejects a reversed range instead of pricing it", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const night = tomorrow();

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(addDays(night, 3)),
        checkOut: toDateParam(night),
      },
    });

    expect(response.status).toBe(400);
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("rejects a calendar date that does not exist", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });

    // `new Date("2026-02-30")` rolls over to 2 March rather than failing, so a
    // lenient parser books a night the traveller never asked for.
    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: "2026-02-30",
        checkOut: "2026-03-02",
      },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/calendar date|YYYY-MM-DD/i);
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("rejects a date that is not in YYYY-MM-DD form", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });

    for (const checkIn of ["1", "next tuesday", "2026/03/01", ""]) {
      const response = await callRoute(bookHotel, {
        method: "POST",
        token: tokenFor(guest.id),
        json: {
          hotelId: String(hotel.id),
          roomTypeId: String(roomType.id),
          checkIn,
          checkOut: "2026-03-05",
        },
      });
      expect(response.status, `checkIn=${JSON.stringify(checkIn)}`).toBe(400);
    }

    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("rejects a night beyond the booking horizon", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    // Three nights of availability only.
    const roomType = await createRoomType({ hotelId: hotel.id, nights: 3 });
    // Well past the 60-night window, so genuinely not on sale.
    const beyondHorizon = addDays(tomorrow(), AVAILABILITY_HORIZON_DAYS + 30);

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(beyondHorizon),
        checkOut: toDateParam(addDays(beyondHorizon, 1)),
      },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/not supported for booking/i);
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("books a stay inside the horizon even when the calendar was never written", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    /*
     * A room type with no availability rows at all: what a fixture that inserts
     * `RoomType` rows straight from SQL produces, and what a room type restored
     * from an older dump looks like. The stay is inside the horizon, so the route
     * has to open those nights rather than turn the guest away — this is the
     * reported bug: "Book Now" on a listed hotel answering
     * "The selected date is not supported for booking." for next week.
     */
    const roomType = await createRoomType({ hotelId: hotel.id, nights: 0 });

    const checkIn = atMidnight(addDays(new Date(), 3));
    const checkOut = addDays(checkIn, 2);

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(checkIn),
        checkOut: toDateParam(checkOut),
      },
    });

    expect(response.status).toBe(201);

    const nights = await prisma.roomAvailabilityRecord.findMany({
      where: { roomTypeId: roomType.id },
      orderBy: { date: "asc" },
      select: { date: true, availability: true },
    });
    // Both nights were opened at the room type's capacity and then claimed.
    expect(nights.map((row) => toDateParam(row.date))).toEqual([
      toDateParam(checkIn),
      toDateParam(addDays(checkIn, 1)),
    ]);
    expect(nights.every((row) => row.availability === roomType.currentAvailability - 1)).toBe(
      true
    );
  });

  it("leaves the last night of the horizon bookable", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id, nights: 0 });

    // The final night the site advertises: exactly the horizon, inclusive.
    const checkIn = atMidnight(addDays(new Date(), AVAILABILITY_HORIZON_DAYS - 1));

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(checkIn),
        checkOut: toDateParam(addDays(checkIn, 1)),
      },
    });

    expect(response.status).toBe(201);
  });

  it("rejects a room type that belongs to a different hotel", async () => {
    const guest = await createUser();
    const hotelA = await createHotel({ ownerId: null });
    const hotelB = await createHotel({ ownerId: null });
    const roomTypeB = await createRoomType({ hotelId: hotelB.id });

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotelA.id),
        roomTypeId: String(roomTypeB.id),
        checkIn: toDateParam(tomorrow()),
        checkOut: toDateParam(addDays(tomorrow(), 1)),
      },
    });

    expect(response.status).toBe(404);
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("rejects a booking with missing fields", async () => {
    const guest = await createUser();

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: { hotelId: "1" },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toBe("Missing required fields");
  });
});

describe("identifier fields", () => {
  it("accepts a booking whose ids are sent as JSON numbers", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });

    // JSON has a single number type, so a client written in another language, a
    // Postman collection or a hand-written request naturally sends `5`, not
    // `"5"`. Both mean the same id and both must book.
    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: hotel.id,
        roomTypeId: roomType.id,
        checkIn: toDateParam(tomorrow()),
        checkOut: toDateParam(addDays(tomorrow(), 1)),
      },
    });

    expect(response.status).toBe(201);
    expect(await prisma.hotelReservation.count()).toBe(1);
  });

  it("still accepts the same ids as numeric strings", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });

    const response = await callRoute(bookHotel, {
      method: "POST",
      token: tokenFor(guest.id),
      json: {
        hotelId: String(hotel.id),
        roomTypeId: String(roomType.id),
        checkIn: toDateParam(tomorrow()),
        checkOut: toDateParam(addDays(tomorrow(), 1)),
      },
    });

    expect(response.status).toBe(201);
    expect(await prisma.hotelReservation.count()).toBe(1);
  });

  it("rejects an id that is not a positive integer, whatever its JSON type", async () => {
    const guest = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });

    // `Number(true)` is 1 and `Number([5])` is 5, so coercing instead of
    // type-checking would turn a boolean or an array into a plausible id and
    // book against the wrong record. Floats, zero and negatives are not ids
    // either, and a non-numeric string stays a `400` as it always was.
    const invalidHotelIds: unknown[] = [
      0,
      -1,
      1.5,
      "0",
      "-1",
      "1.5",
      "abc",
      true,
      false,
      [],
      [hotel.id],
      {},
    ];

    for (const hotelId of invalidHotelIds) {
      const label = `hotelId=${JSON.stringify(hotelId)}`;
      const response = await callRoute(bookHotel, {
        method: "POST",
        token: tokenFor(guest.id),
        json: {
          hotelId,
          roomTypeId: String(roomType.id),
          checkIn: toDateParam(tomorrow()),
          checkOut: toDateParam(addDays(tomorrow(), 1)),
        },
      });

      expect(response.status, label).toBe(400);
      const body = await readJson<{ error: string }>(response);
      expect(body.error, label).toMatch(/positive integer/i);
    }

    // Not one of those requests reached the database.
    expect(await prisma.hotelReservation.count()).toBe(0);
  });

  it("accepts a numeric itinerary id at checkout", async () => {
    const user = await createUser();
    const itinerary = await createItineraryRow({ userId: user.id });

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: itinerary.id,
        cardNumber: "4242424242424242",
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(200);
  });

  it("accepts a numeric reservation id when building an itinerary", async () => {
    const user = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const reservation = await createHotelReservation({
      userId: user.id,
      hotelId: hotel.id,
      roomTypeId: roomType.id,
      checkIn: tomorrow(),
      checkOut: addDays(tomorrow(), 1),
    });

    const response = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: { hotelReservationId: reservation.id },
    });

    expect(response.status).toBe(201);
    const body = await readJson<{ reservations: { id: number } }>(response);
    expect(body.reservations.id).toBeGreaterThan(0);
  });
});

describe("route segments", () => {
  it("rejects a non-numeric hotel id with 400 rather than 500", async () => {
    const response = await callRoute(getHotel, { params: { hotelId: "abc" } });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/positive integer/i);
  });

  it("rejects a non-numeric room type id with 400", async () => {
    const hotel = await createHotel({ ownerId: null });

    const response = await callRoute(getRoomType, {
      params: { hotelId: String(hotel.id), roomTypeId: "not-a-number" },
    });

    expect(response.status).toBe(400);
  });

  it("rejects a non-numeric booking id with 400", async () => {
    const user = await createUser();

    const response = await callRoute(getFlightBooking, {
      params: { bookingId: "abc" },
      token: tokenFor(user.id),
    });

    expect(response.status).toBe(400);
  });

  it("rejects a zero or negative identifier with 400", async () => {
    const response = await callRoute(getHotel, { params: { hotelId: "0" } });
    expect(response.status).toBe(400);

    const negative = await callRoute(getHotel, { params: { hotelId: "-4" } });
    expect(negative.status).toBe(400);
  });
});

describe("checkout payloads", () => {
  async function arrangeItinerary() {
    const user = await createUser();
    const itinerary = await createItineraryRow({ userId: user.id });
    return { user, itinerary };
  }

  it("rejects a card number that is too short", async () => {
    const { user, itinerary } = await arrangeItinerary();

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: "4242",
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/invalid card number/i);
  });

  it("rejects a numeric card number instead of crashing on it", async () => {
    const { user, itinerary } = await arrangeItinerary();

    // A JSON number has no `.length`, so the type check has to come first:
    // reading `.length` on a number throws a `TypeError`, which the endpoint
    // reports as a `500`.
    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: 4242424242424242,
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(400);
  });

  it("rejects a card number containing letters", async () => {
    const { user, itinerary } = await arrangeItinerary();

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: "4242abcd42424242",
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(400);
  });

  it("rejects a malformed expiry", async () => {
    const { user, itinerary } = await arrangeItinerary();

    for (const cardExpiry of ["2030-12", "13/30", "12", "12/2030/1"]) {
      const response = await callRoute(checkout, {
        method: "POST",
        token: tokenFor(user.id),
        json: {
          itineraryId: String(itinerary.id),
          cardNumber: "4242424242424242",
          cardExpiry,
        },
      });
      expect(response.status, `cardExpiry=${cardExpiry}`).toBe(400);
    }

    const stored = await prisma.itinerary.findUniqueOrThrow({
      where: { id: itinerary.id },
      select: { status: true },
    });
    expect(stored.status).toBe("DRAFT");
  });

  it("stores only the last four digits", async () => {
    const { user, itinerary } = await arrangeItinerary();

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: "4242 4242 4242 1234",
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(200);
    const stored = await prisma.itinerary.findUniqueOrThrow({
      where: { id: itinerary.id },
      select: { cardNumber: true },
    });
    expect(stored.cardNumber).toBe("1234");
  });

  it("refuses to check out an itinerary that was cancelled", async () => {
    const { user, itinerary } = await arrangeItinerary();
    await prisma.itinerary.update({
      where: { id: itinerary.id },
      data: { status: "CANCELLED" },
    });

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(user.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: "4242424242424242",
        cardExpiry: "12/30",
      },
    });

    // Reviving a cancelled itinerary would leave it `CONFIRMED` with no bookings.
    expect(response.status).toBe(409);
  });

  it("reports a foreign itinerary as not found rather than forbidden", async () => {
    const { itinerary } = await arrangeItinerary();
    const stranger = await createUser();

    const response = await callRoute(checkout, {
      method: "POST",
      token: tokenFor(stranger.id),
      json: {
        itineraryId: String(itinerary.id),
        cardNumber: "4242424242424242",
        cardExpiry: "12/30",
      },
    });

    expect(response.status).toBe(404);
  });
});

describe("registration and login payloads", () => {
  it("rejects an invalid email address", async () => {
    const response = await callRoute(register, {
      method: "POST",
      json: {
        email: "not-an-email",
        password: "supersecret",
        firstName: "A",
        lastName: "B",
      },
    });

    expect(response.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a password that is too short", async () => {
    const response = await callRoute(register, {
      method: "POST",
      json: {
        email: "short@example.com",
        password: "abc",
        firstName: "A",
        lastName: "B",
      },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/at least 6/i);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a login without credentials", async () => {
    const response = await callRoute(login, { method: "POST", json: {} });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toBe("Email and password are required");
  });

  it("rejects a malformed JSON body with 400", async () => {
    const response = await callRoute(login, {
      method: "POST",
      json: undefined,
      headers: { "content-type": "application/json" },
    });

    // No body at all is a JSON parse failure, which must be a `400` and not a
    // framework-level HTML error page.
    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/valid JSON/i);
  });

  it("rejects a body that is a JSON array", async () => {
    const response = await callRoute(login, { method: "POST", json: [1, 2, 3] });

    expect(response.status).toBe(400);
  });
});

describe("query parameters", () => {
  it("rejects an out-of-range star rating", async () => {
    const tooHigh = await callRoute(listHotels, { query: "starRating=9" });
    expect(tooHigh.status).toBe(400);

    const notANumber = await callRoute(listHotels, { query: "starRating=four" });
    expect(notANumber.status).toBe(400);

    const negativePrice = await callRoute(listHotels, { query: "priceMin=-5" });
    expect(negativePrice.status).toBe(400);
  });

  it("rejects an over-long search string", async () => {
    const response = await callRoute(listHotels, { query: `name=${"a".repeat(101)}` });

    expect(response.status).toBe(400);
  });

  it("accepts an empty query and returns the catalogue", async () => {
    const hotel = await createHotel({ ownerId: null });

    const response = await callRoute(listHotels);
    const body = await readJson<{ hotels: { id: number }[] }>(response);

    expect(response.status).toBe(200);
    expect(body.hotels.map((row) => row.id)).toContain(hotel.id);
  });
});

describe("itinerary payloads", () => {
  it("rejects a request that names no reservation", async () => {
    const user = await createUser();

    const response = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: {},
    });

    expect(response.status).toBe(400);
    expect(await prisma.itinerary.count()).toBe(0);
  });

  it("rejects a non-numeric reservation id", async () => {
    const user = await createUser();

    const response = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: { hotelReservationId: "abc" },
    });

    expect(response.status).toBe(400);
  });

  it("refuses to link a reservation that was already cancelled", async () => {
    const user = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const checkIn = tomorrow();
    const checkOut = addDays(checkIn, 1);

    const reservation = await prisma.hotelReservation.create({
      data: {
        userId: user.id,
        hotelId: hotel.id,
        roomTypeId: roomType.id,
        checkIn,
        checkOut,
        price: 100,
        status: "CANCELLED",
      },
    });

    const response = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: { hotelReservationId: String(reservation.id) },
    });

    expect(response.status).toBe(409);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/cancelled/i);
  });

  it("refuses to link the same reservation twice", async () => {
    const user = await createUser();
    const hotel = await createHotel({ ownerId: null });
    const roomType = await createRoomType({ hotelId: hotel.id });
    const checkIn = tomorrow();
    const checkOut = addDays(checkIn, 1);

    const reservation = await prisma.hotelReservation.create({
      data: {
        userId: user.id,
        hotelId: hotel.id,
        roomTypeId: roomType.id,
        checkIn,
        checkOut,
        price: 250,
        status: "CONFIRMED",
      },
    });

    const first = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: { hotelReservationId: String(reservation.id) },
    });
    expect(first.status).toBe(201);

    const second = await callRoute(createItinerary, {
      method: "POST",
      token: tokenFor(user.id),
      json: { hotelReservationId: String(reservation.id) },
    });
    expect(second.status).toBe(409);

    // The reservation belongs to exactly one itinerary, and there is only one.
    const itineraries = await prisma.itinerary.findMany({
      where: { userId: user.id },
      select: { id: true, totalPrice: true },
    });
    expect(itineraries).toHaveLength(1);
    expect(itineraries[0]?.totalPrice).toBe(250);

    const stored = await prisma.hotelReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      select: { itineraryId: true },
    });
    expect(stored.itineraryId).toBe(itineraries[0]?.id);
  });
});
