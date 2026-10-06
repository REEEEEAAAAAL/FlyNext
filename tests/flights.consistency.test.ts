/**
 * Cross-system consistency suite: the flight ticket that cannot be recorded.
 *
 * `POST /api/flights/book` buys a real ticket from AFS and then writes a local
 * `FlightReservation` row so that booking history, cancellation and the itinerary
 * price have something to point at. If the local write fails, the airline has been
 * paid and this application has no idea the booking exists — the state that
 * `createFlightReservation` compensates for.
 *
 * The suite drives that path by injecting the AFS calls (`createFlightReservation`
 * takes them as a dependency), so the failure is produced deliberately instead of
 * hoping the network misbehaves at the right moment. Both outcomes are covered:
 * the ticket is released, and the ticket could not be released — the second is the
 * one that has to leave a record an operator can act on.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as bookFlight } from "@/app/api/flights/book/route";
import { flightDirections } from "@/app/lib/booking-display";
import {
	createFlightReservation,
	toFlightLegDto,
} from "@/lib/reservations";
import { prisma, resetDatabase, disconnect } from "#support/db";
import { createUser } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";
import type { AfsBooking, AfsFlight } from "@/types";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

/** A flight leg shaped like the AFS response. */
function flight(overrides: Partial<AfsFlight> = {}): AfsFlight {
  return {
    id: "FL-1",
    airline: { code: "AC", name: "Air Canada" },
    departureTime: "2026-07-01T08:00:00.000Z",
    arrivalTime: "2026-07-01T16:00:00.000Z",
    origin: { code: "YYZ", name: "Toronto Pearson", city: "Toronto", country: "Canada" },
    destination: { code: "LHR", name: "Heathrow", city: "London", country: "UK" },
    price: 512.5,
    availableSeats: 9,
    status: "SCHEDULED",
    ...overrides,
  } as AfsFlight;
}

/** An AFS booking response. */
function booking(overrides: Partial<AfsBooking> = {}): AfsBooking {
  return {
    bookingReference: "AFS-REF-1",
    ticketNumber: "TKT-1",
    status: "CONFIRMED",
    flights: [flight()],
    ...overrides,
  };
}

/** The payload `POST /api/flights/book` builds from its request body. */
const REQUEST_PAYLOAD = {
  email: "traveller@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  passportNumber: "P1234567",
  flightIds: ["FL-1"],
};

describe("recording a booking that AFS accepted", () => {
  it("writes the local reservation and returns it", async () => {
    const user = await createUser();

    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking(),
    });

    expect(result.reservationId).toBeGreaterThan(0);
    const stored = await prisma.flightReservation.findUniqueOrThrow({
      where: { id: result.reservationId },
    });
    expect(stored.afsBookingId).toBe("AFS-REF-1");
    expect(stored.userId).toBe(user.id);
    expect(stored.price).toBe(512.5);
    expect(stored.status).toBe("CONFIRMED");
  });

  it("sums both legs of a round trip and records the return leg", async () => {
    const user = await createUser();
    const outbound = flight({ id: "OUT", price: 300 });
    const inbound = flight({
      id: "IN",
      price: 250,
      departureTime: "2026-07-15T08:00:00.000Z",
      arrivalTime: "2026-07-15T16:00:00.000Z",
      origin: { code: "LHR", name: "Heathrow", city: "London", country: "UK" },
      destination: { code: "YYZ", name: "Toronto Pearson", city: "Toronto", country: "Canada" },
    });

    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking({ flights: [outbound, inbound] }),
    });

    const stored = await prisma.flightReservation.findUniqueOrThrow({
      where: { id: result.reservationId },
    });
    expect(stored.price).toBe(550);
    const departure = stored.departure as Record<string, unknown>;
    expect(departure.goAirport).toBe("YYZ");
    expect(departure.returnAirport).toBe("LHR");
  });
});

/**
 * The directions a booking is recorded as flying.
 *
 * The provider answers with one flat list of legs, whether the ticket is a
 * one-way with a connection or a round trip with one on each half. Grouping them
 * into directions is what the booking history renders, and grouping them by
 * position alone put a connecting one-way on the page as an "Outbound" card and a
 * "Return" card that were really its first and second legs — while a connecting
 * round trip showed its outbound half twice and never showed the way home.
 */
describe("recording the directions flown", () => {
  /** YYZ→HKG→CAN: one outbound journey that changes planes in Hong Kong. */
  const OUTBOUND = [
    flight({
      id: "OUT-1",
      departureTime: "2026-07-01T15:20:00.000Z",
      arrivalTime: "2026-07-02T07:20:00.000Z",
      origin: { code: "YYZ", name: "Toronto Pearson", city: "Toronto", country: "Canada" },
      destination: { code: "HKG", name: "Hong Kong", city: "Hong Kong", country: "Hong Kong" },
      price: 700,
    }),
    flight({
      id: "OUT-2",
      departureTime: "2026-07-02T08:40:00.000Z",
      arrivalTime: "2026-07-02T09:35:00.000Z",
      origin: { code: "HKG", name: "Hong Kong", city: "Hong Kong", country: "Hong Kong" },
      destination: { code: "CAN", name: "Guangzhou Baiyun", city: "Guangzhou", country: "China" },
      price: 200,
    }),
  ];

  /** CAN→DXB→YYZ: the way home, with a connection of its own. */
  const INBOUND = [
    flight({
      id: "IN-1",
      departureTime: "2026-07-10T12:50:00.000Z",
      arrivalTime: "2026-07-11T05:55:00.000Z",
      origin: { code: "CAN", name: "Guangzhou Baiyun", city: "Guangzhou", country: "China" },
      destination: { code: "DXB", name: "Dubai", city: "Dubai", country: "United Arab Emirates" },
      price: 600,
    }),
    flight({
      id: "IN-2",
      departureTime: "2026-07-11T08:55:00.000Z",
      arrivalTime: "2026-07-11T20:30:00.000Z",
      origin: { code: "DXB", name: "Dubai", city: "Dubai", country: "United Arab Emirates" },
      destination: { code: "YYZ", name: "Toronto Pearson", city: "Toronto", country: "Canada" },
      price: 500,
    }),
  ];

  /**
   * The cards the booking history page renders for a stored reservation.
   *
   * Goes through the endpoint's own projection (`toFlightLegDto`) and the
   * page's own helper (`flightDirections`), so what is asserted is what the
   * traveller sees rather than the shape of the JSON column.
   */
  async function directionsOf(reservationId: number) {
    const stored = await prisma.flightReservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    return flightDirections(
      toFlightLegDto(stored.departure),
      toFlightLegDto(stored.arrival)
    );
  }

  it("shows a connecting one-way as one direction, not as an outbound and a return", async () => {
    const user = await createUser();

    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking({ flights: OUTBOUND }),
      returnLegCount: 0,
    });

    const directions = await directionsOf(result.reservationId);
    expect(directions).toHaveLength(1);
    expect(directions[0]).toMatchObject({
      kind: "outbound",
      from: "YYZ",
      to: "CAN",
      departDate: "2026-07-01T15:20:00.000Z",
      arriveDate: "2026-07-02T09:35:00.000Z",
    });
    // The journey changes planes in Hong Kong, and says so: the summary alone
    // reads as a non-stop Toronto–Guangzhou flight.
    expect(directions[0].stops).toEqual(["HKG"]);
    expect(directions[0].legs.map((leg) => `${leg.from}>${leg.to}`)).toEqual([
      "YYZ>HKG",
      "HKG>CAN",
    ]);
  });

  it("reads a connecting one-way the same way without a declared split", async () => {
    const user = await createUser();

    // A one-way ticket never lands back where it started, which is what the
    // derivation keys on; nothing has to tell it so.
    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking({ flights: OUTBOUND }),
    });

    const directions = await directionsOf(result.reservationId);
    expect(directions).toHaveLength(1);
    expect(directions[0]).toMatchObject({ from: "YYZ", to: "CAN" });
  });

  it("shows a connecting round trip as outbound YYZ→CAN and return CAN→YYZ", async () => {
    const user = await createUser();

    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking({ flights: [...OUTBOUND, ...INBOUND] }),
      returnLegCount: INBOUND.length,
    });

    const stored = await prisma.flightReservation.findUniqueOrThrow({
      where: { id: result.reservationId },
    });
    // One ticket, so one price: both halves of the trip.
    expect(stored.price).toBe(2000);

    const directions = await directionsOf(result.reservationId);
    expect(directions.map((direction) => direction.kind)).toEqual([
      "outbound",
      "return",
    ]);
    expect(directions[0]).toMatchObject({
      from: "YYZ",
      to: "CAN",
      departDate: "2026-07-01T15:20:00.000Z",
      arriveDate: "2026-07-02T09:35:00.000Z",
    });
    expect(directions[1]).toMatchObject({
      from: "CAN",
      to: "YYZ",
      departDate: "2026-07-10T12:50:00.000Z",
      arriveDate: "2026-07-11T20:30:00.000Z",
    });
    // Each half keeps its own connection: Hong Kong on the way out, Dubai on the
    // way home.
    expect(directions.map((direction) => direction.stops)).toEqual([
      ["HKG"],
      ["DXB"],
    ]);
  });

  it("derives the same two directions for a round trip with no declared split", async () => {
    const user = await createUser();

    const result = await createFlightReservation(REQUEST_PAYLOAD, user.id, {
      createBooking: async () => booking({ flights: [...OUTBOUND, ...INBOUND] }),
    });

    // The stay is the longest wait between two legs, and it is the only one at
    // that length: one hour and twenty minutes in Hong Kong, three hours in
    // Dubai, against six days in Guangzhou.
    const directions = await directionsOf(result.reservationId);
    expect(directions.map((direction) => direction.from)).toEqual(["YYZ", "CAN"]);
    expect(directions.map((direction) => direction.to)).toEqual(["CAN", "YYZ"]);
  });
});

describe("compensation when the local write fails", () => {
  it("releases the ticket and reports the booking as failed", async () => {
    const user = await createUser();

    // Occupy the reference the stub is about to return, so the local insert hits
    // the unique index on `afsBookingId` — a database failure, not a fake one.
    await prisma.flightReservation.create({
      data: {
        userId: user.id,
        afsBookingId: "AFS-REF-1",
        departure: {},
        arrival: {},
        price: 1,
        status: "CANCELLED",
      },
    });

    const cancelFlight = vi.fn(async () => ({ status: "CANCELLED" }));
    const events: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      events.push(args.map(String).join(" "));
    });

    await expect(
      createFlightReservation(REQUEST_PAYLOAD, user.id, {
        createBooking: async () => booking(),
        cancelFlight,
      })
    ).rejects.toMatchObject({ status: 502 });

    // The ticket was released with the reference and surname AFS needs.
    expect(cancelFlight).toHaveBeenCalledTimes(1);
    expect(cancelFlight).toHaveBeenCalledWith("AFS-REF-1", "Lovelace");

    // A released ticket is self-resolved, so it is logged as an event, not an
    // alert — and no second reservation was created.
    expect(events.some((line) => line.includes("flight.booking.compensated"))).toBe(true);
    expect(events.some((line) => line.includes("flight.booking.orphaned"))).toBe(false);
    expect(
      await prisma.flightReservation.count({ where: { afsBookingId: "AFS-REF-1" } })
    ).toBe(1);

    spy.mockRestore();
  });

  it("raises an alert with the booking reference when the ticket cannot be released", async () => {
    const user = await createUser();

    await prisma.flightReservation.create({
      data: {
        userId: user.id,
        afsBookingId: "AFS-REF-ORPHAN",
        departure: {},
        arrival: {},
        price: 1,
        status: "CANCELLED",
      },
    });

    const records: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      records.push(args.map(String).join(" "));
    });

    await expect(
      createFlightReservation(REQUEST_PAYLOAD, user.id, {
        createBooking: async () => booking({ bookingReference: "AFS-REF-ORPHAN" }),
        // The airline refuses, which is exactly the case that needs a human.
        cancelFlight: async () => ({ status: "CONFIRMED" }),
      })
    ).rejects.toMatchObject({ status: 502 });

    const alert = records.find((line) => line.includes("flight.booking.orphaned"));
    expect(alert).toBeDefined();

    // The record has to be actionable on its own: it is the only trace of a
    // booking that exists upstream and nowhere locally.
    const json = JSON.parse(alert!.slice(alert!.indexOf("{"))) as {
      alert: boolean;
      detail: Record<string, unknown>;
    };
    expect(json.alert).toBe(true);
    expect(json.detail.bookingReference).toBe("AFS-REF-ORPHAN");
    expect(String(json.detail.reason)).toMatch(/did not confirm/i);

    spy.mockRestore();
  });

  it("treats an AFS booking with no legs as a failure and releases it", async () => {
    const user = await createUser();
    const cancelFlight = vi.fn(async () => ({ status: "CANCELLED" }));

    await expect(
      createFlightReservation(REQUEST_PAYLOAD, user.id, {
        createBooking: async () => booking({ flights: [] }),
        cancelFlight,
      })
    ).rejects.toMatchObject({ status: 502 });

    // A ticket with nothing usable in it is worse than no ticket, so it is
    // released rather than recorded.
    expect(cancelFlight).toHaveBeenCalledWith("AFS-REF-1", "Lovelace");
    expect(await prisma.flightReservation.count()).toBe(0);
  });

  it("alerts rather than staying silent when the release call itself throws", async () => {
    const user = await createUser();

    await prisma.flightReservation.create({
      data: {
        userId: user.id,
        afsBookingId: "AFS-REF-THROW",
        departure: {},
        arrival: {},
        price: 1,
        status: "CANCELLED",
      },
    });

    const records: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      records.push(args.map(String).join(" "));
    });

    await expect(
      createFlightReservation(REQUEST_PAYLOAD, user.id, {
        createBooking: async () => booking({ bookingReference: "AFS-REF-THROW" }),
        cancelFlight: async () => {
          throw new Error("upstream unreachable");
        },
      })
    ).rejects.toMatchObject({ status: 502 });

    const alert = records.find((line) => line.includes("flight.booking.orphaned"));
    expect(alert).toBeDefined();
    expect(alert).toContain("upstream unreachable");

    spy.mockRestore();
  });
});

describe("POST /api/flights/book", () => {
  it("rejects a request body without the required passenger fields", async () => {
    const user = await createUser();

    const response = await callRoute(bookFlight, {
      method: "POST",
      token: tokenFor(user.id),
      json: { email: "a@b.com" },
    });

    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toMatch(/missing required fields/i);
  });

  it("rejects a flightIds value that is not an array of ids", async () => {
    const user = await createUser();

    for (const flightIds of ["FL-1", [], [""], [1, 2]]) {
      const response = await callRoute(bookFlight, {
        method: "POST",
        token: tokenFor(user.id),
        json: { ...REQUEST_PAYLOAD, flightIds },
      });
      expect(response.status, JSON.stringify(flightIds)).toBe(400);
    }
  });

  it("rejects a returnLegCount that is not a split of the itinerary", async () => {
    const user = await createUser();

    // `REQUEST_PAYLOAD` holds a single id, so only `0` (one-way) can be a real
    // split of it. Anything else is refused rather than recorded as a booking
    // with one of its halves missing.
    for (const returnLegCount of [2, -1, 1.5, "1", true]) {
      const response = await callRoute(bookFlight, {
        method: "POST",
        token: tokenFor(user.id),
        json: { ...REQUEST_PAYLOAD, returnLegCount },
      });
      expect(response.status, JSON.stringify(returnLegCount)).toBe(400);
    }
  });

  it("refuses an anonymous caller", async () => {
    const response = await callRoute(bookFlight, {
      method: "POST",
      token: null,
      json: REQUEST_PAYLOAD,
    });

    expect(response.status).toBe(401);
  });
});
