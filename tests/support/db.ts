/**
 * Database helpers shared by the API suites.
 *
 * The suites run against a dedicated PostgreSQL database (see
 * `tests/setup/load-env.ts`), which means they exercise the real column types,
 * unique constraints and transaction semantics — the oversell case is only
 * meaningful against a database that can actually serialise two `updateMany`
 * statements. The cost is that rows outlive a single test, so each suite clears
 * the tables it uses.
 */

import { PrismaClient } from "@prisma/client";
import { resetLedgerReporting } from "@/lib/afs/ledger";
import { resetBookingLedger } from "@/lib/afs/offline";

export const prisma = new PrismaClient();

/**
 * Tables in foreign-key order, children first.
 *
 * Deleting in this order avoids relying on `ON DELETE CASCADE` for the models
 * where the relation is `SetNull` (a hotel must not survive its reservations if
 * the test then expects them gone).
 *
 * `AfsOfflineBooking` is the offline flight provider's own state, and it has no
 * relations — but it is truncated with the rest, because a booking left behind
 * would let one case's seat sales and cancellations be read by the next. Its
 * in-process twin is cleared by {@link resetDatabase} for the same reason.
 */
const TABLES_IN_DELETE_ORDER = [
  "AfsOfflineBooking",
  "Notification",
  "HotelReservation",
  "FlightReservation",
  "Itinerary",
  "RoomAvailabilityRecord",
  "RoomType",
  "Hotel",
  "Airport",
  "City",
  "User",
] as const;

/**
 * Remove every row from every application table, and the provider's memory.
 *
 * `TRUNCATE ... RESTART IDENTITY CASCADE` is used rather than `deleteMany` so
 * that ids restart at 1 for each test. Several handlers return ids in their
 * payload and the suites assert on them; predictable ids keep the assertions
 * readable and, more importantly, mean a leftover row from an earlier test can
 * never be mistaken for one this test created.
 *
 * The offline flight provider's own table is truncated with the rest, and its
 * in-process twin cleared alongside it: the two are the same state, and a booking
 * left in either would be found again by a later case — flight ids are
 * deterministic, so it would be found for a flight that case searches for. That
 * truncation is also why the timetable registry is left alone here; a case whose
 * own state depends on which flights it has already built calls
 * `resetFlightRegistry()` for itself.
 */
export async function resetDatabase(): Promise<void> {
  const list = TABLES_IN_DELETE_ORDER.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
  );
  resetBookingLedger();
  resetLedgerReporting();
}

/** Close the pool so Vitest can exit without waiting on open handles. */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
