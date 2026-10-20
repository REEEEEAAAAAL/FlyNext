import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { flightSelectFields } from "../app/api/flights/utils";

class Failure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const include = { flights: { select: flightSelectFields } };
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "x-afs-booking-protocol": "1", "Cache-Control": "private, no-store" } });
}
type Ticket = Prisma.BookingGetPayload<{ include: typeof include }>;
function present(booking: Ticket) {
  const { id, operationKey: _key, requestHash: _hash, ...rest } = booking;
  return { ...rest, bookingReference: id.toUpperCase(), ticketNumber: id };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function field(data: Record<string, unknown>, name: string, limit = 256): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Failure(400, "Invalid booking request");
  return value.trim();
}
async function lookup(tx: Prisma.TransactionClient, agencyId: string, lastName: string, reference: string) {
  if (!/^(?:[a-f0-9]{6}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(reference)) throw new Failure(404, "Booking not found");
  const rows = await tx.booking.findMany({
    where: { agencyId, lastName: { equals: lastName, mode: "insensitive" },
      id: reference.length === 6 ? { startsWith: reference.toLowerCase() } : reference.toLowerCase() },
    include, take: 2,
  });
  if (rows.length !== 1) throw new Failure(404, "Booking not found");
  return rows[0];
}

export async function handleBooking(request: NextRequest, action: "create" | "retrieve" | "cancel") {
  try {
    const key = request.headers.get("x-api-key");
    if (!key) throw new Failure(401, "No API key found in request");
    const agency = await prisma.agency.findUnique({ where: { apiKey: key, isActive: true } });
    if (!agency) throw new Failure(403, "Invalid API key");
    const data: unknown = action === "retrieve" ? Object.fromEntries(request.nextUrl.searchParams) : await request.json();
    if (!record(data)) throw new Failure(400, "Invalid booking request");
    if (action === "create") {
      const firstName = field(data, "firstName"), lastName = field(data, "lastName");
      const email = field(data, "email"), passportNumber = field(data, "passportNumber");
      const ids = data.flightIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || !ids.every((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128) || new Set(ids).size !== ids.length || passportNumber.length < 9) throw new Failure(400, "Invalid booking request");
      const operationKey = request.headers.get("Idempotency-Key") ?? randomUUID();
      if (!/^[A-Za-z0-9:_-]{8,128}$/.test(operationKey)) throw new Failure(400, "Invalid Idempotency-Key");
      const requestHash = createHash("sha256").update(JSON.stringify({ firstName, lastName, email, passportNumber, flightIds: ids })).digest("hex");
      const booking = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${agency.id}:${operationKey}`}, 0))`;
        const existing = await tx.booking.findUnique({ where: { agencyId_operationKey: { agencyId: agency.id, operationKey } }, include });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new Failure(409, "Idempotency-Key was already used");
          return existing;
        }
        for (const id of [...ids].sort()) await tx.$queryRaw`SELECT id FROM flights WHERE id = ${id} FOR UPDATE`;
        const flights = await tx.flight.findMany({ where: { id: { in: ids } }, orderBy: { departureTime: "asc" } });
        if (flights.length !== ids.length) throw new Failure(404, "One or more flights not found");
        for (let i = 0; i < flights.length; i++) {
          const flight = flights[i];
          if (flight.status !== "SCHEDULED" || flight.availableSeats < 1 || flight.departureTime <= new Date()) throw new Failure(400, "Flight unavailable");
          if (i && flights[i - 1].arrivalTime >= flight.departureTime) throw new Failure(400, "Flights are not consecutive in sequence");
          const changed = await tx.flight.updateMany({ where: { id: flight.id, availableSeats: { gt: 0 }, status: "SCHEDULED" }, data: { availableSeats: { decrement: 1 } } });
          if (changed.count !== 1) throw new Failure(400, "Flight unavailable");
        }
        return tx.booking.create({ data: { firstName, lastName, email, passportNumber, agencyId: agency.id, operationKey, requestHash, status: "CONFIRMED", flights: { connect: ids.map(id => ({ id })) } }, include });
      }, { timeout: 20000, maxWait: 20000 });
      return reply(present(booking));
    }
    const operationKey = data.operationKey;
    if (action === "retrieve" && typeof operationKey === "string" && /^[A-Za-z0-9:_-]{8,128}$/.test(operationKey)) {
      const booking = await prisma.booking.findUnique({ where: { agencyId_operationKey: { agencyId: agency.id, operationKey } }, include });
      if (!booking) throw new Failure(404, "Booking not found");
      return reply(present(booking));
    }
    const lastName = field(data, "lastName"), reference = field(data, "bookingReference");
    const booking = await prisma.$transaction(async tx => {
      const found = await lookup(tx, agency.id, lastName, reference);
      if (action === "retrieve") return found;
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.id} FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({ where: { id: found.id }, include });
      if (current.status === "CANCELLED") return current;
      if (current.status !== "CONFIRMED") throw new Failure(409, "Booking is unavailable");
      for (const flight of [...current.flights].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.flight.update({ where: { id: flight.id }, data: { availableSeats: { increment: 1 } } });
      }
      return tx.booking.update({ where: { id: found.id }, data: { status: "CANCELLED" }, include });
    }, { timeout: 20000, maxWait: 20000 });
    return reply(present(booking));
  } catch (error) {
    if (error instanceof Failure) return reply({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return reply({ error: "Invalid JSON" }, 400);
    console.error("[afs] booking operation failed");
    return reply({ error: "Booking operation failed" }, 500);
  }
}
