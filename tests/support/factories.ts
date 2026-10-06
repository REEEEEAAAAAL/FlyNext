/**
 * Row factories.
 *
 * Every factory takes an optional override object so a test states only the field
 * it is actually about — "a hotel owned by somebody else" reads as
 * `createHotel({ ownerId: otherId })` rather than eleven lines of setup. Defaults
 * are chosen to satisfy the schema's non-null columns and its natural keys
 * (`(roomTypeId, date)` on availability, the unique email on a user).
 */

import { hashPassword } from "@/lib/auth";
import { prisma } from "./db";

/** The password every factory-created user is given. */
export const TEST_PASSWORD = "correct-horse-battery";

/** A user, hashed and ready to sign in. */
export async function createUser(
  overrides: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    IsHotelOwner?: boolean;
  } = {}
) {
  const suffix = nextId();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${suffix}@example.com`,
      password: await hashPassword(overrides.password ?? TEST_PASSWORD),
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? `User${suffix}`,
      IsHotelOwner: overrides.IsHotelOwner ?? false,
    },
  });
}

/** A hotel, optionally owned. */
export async function createHotel(
  overrides: {
    ownerId?: number | null;
    name?: string;
    location?: string;
    starRating?: number;
  } = {}
) {
  const suffix = nextId();
  return prisma.hotel.create({
    data: {
      name: overrides.name ?? `Hotel ${suffix}`,
      logo: "/hotel-logo-default.svg",
      address: `${suffix} Test Street`,
      location: overrides.location ?? "Toronto, Canada",
      starRating: overrides.starRating ?? 4,
      images: [],
      ownerId: overrides.ownerId ?? null,
    },
  });
}

/**
 * A room type with availability for `nights` nights starting `startsOn`.
 *
 * The availability rows are the ones the booking flow decrements, so a factory
 * that only created the room type would produce a booking that always fails with
 * "the selected date is not supported".
 */
export async function createRoomType(
  overrides: {
    hotelId: number;
    name?: string;
    pricePerNight?: number;
    availability?: number;
    startsOn?: Date;
    nights?: number;
  }
) {
  const suffix = nextId();
  const nights = overrides.nights ?? 10;
  const startsOn = atMidnight(overrides.startsOn ?? new Date());
  const availability = overrides.availability ?? 5;

  const roomType = await prisma.roomType.create({
    data: {
      name: overrides.name ?? `Room ${suffix}`,
      amenities: "Wi-Fi",
      pricePerNight: overrides.pricePerNight ?? 100,
      images: [],
      currentAvailability: availability,
      hotelId: overrides.hotelId,
    },
  });

  await prisma.roomAvailabilityRecord.createMany({
    data: Array.from({ length: nights }, (_unused, offset) => ({
      roomTypeId: roomType.id,
      date: addDays(startsOn, offset),
      availability,
    })),
  });

  return roomType;
}

/** A confirmed hotel reservation, linked to a user and a room type. */
export async function createHotelReservation(overrides: {
  userId: number;
  hotelId: number;
  roomTypeId: number;
  checkIn: Date;
  checkOut: Date;
  price?: number;
  itineraryId?: number | null;
}) {
  return prisma.hotelReservation.create({
    data: {
      userId: overrides.userId,
      hotelId: overrides.hotelId,
      roomTypeId: overrides.roomTypeId,
      checkIn: overrides.checkIn,
      checkOut: overrides.checkOut,
      price: overrides.price ?? 100,
      status: "CONFIRMED",
      itineraryId: overrides.itineraryId ?? null,
    },
  });
}

/** A confirmed flight reservation. */
export async function createFlightReservation(overrides: {
  userId: number;
  afsBookingId?: string;
  price?: number;
  itineraryId?: number | null;
}) {
  const suffix = nextId();
  return prisma.flightReservation.create({
    data: {
      userId: overrides.userId,
      afsBookingId: overrides.afsBookingId ?? `AFS-${suffix}`,
      departure: {
        goDate: "2026-06-01T08:00:00.000Z",
        goAirport: "YYZ",
        returnDate: null,
        returnAirport: null,
      },
      arrival: {
        goDate: "2026-06-01T12:00:00.000Z",
        goAirport: "LHR",
        returnDate: null,
        returnAirport: null,
      },
      price: overrides.price ?? 400,
      status: "CONFIRMED",
      itineraryId: overrides.itineraryId ?? null,
    },
  });
}

/** An itinerary owned by `userId`. */
export async function createItinerary(overrides: {
  userId: number;
  totalPrice?: number;
  status?: "DRAFT" | "CONFIRMED" | "CANCELLED";
}) {
  return prisma.itinerary.create({
    data: {
      userId: overrides.userId,
      totalPrice: overrides.totalPrice ?? 0,
      status: overrides.status ?? "DRAFT",
      cardNumber: "",
      cardExpiry: "",
    },
  });
}

/** A notification belonging to `userId`. */
export async function createNotification(overrides: {
  userId: number;
  content?: string;
  isRead?: boolean;
}) {
  return prisma.notification.create({
    data: {
      userId: overrides.userId,
      content: overrides.content ?? "Test notification",
      isRead: overrides.isRead ?? false,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Local midnight, the granularity every availability row is stored at. */
export function atMidnight(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** `date` shifted by `days`, keeping the local wall-clock time. */
export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Format a `Date` as the `YYYY-MM-DD` string the API accepts. */
export function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Tomorrow at local midnight, the earliest bookable night in every fixture. */
export function tomorrow(): Date {
  return atMidnight(addDays(new Date(), 1));
}

/* -------------------------------------------------------------------------- */

/**
 * A per-process counter that builds unique emails, names and booking references.
 * `Math.random()` would also work, but a counter makes a failing assertion
 * reproducible.
 */
let counter = 0;
function nextId(): number {
  counter += 1;
  return counter;
}
