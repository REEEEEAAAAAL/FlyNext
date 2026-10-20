/** Durable booking records and atomic seat claims for the built-in flight provider. */

import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "../prisma";
import { badGateway, badRequest } from "../api/errors";
import { reportEvent } from "../api/events";

/** A booking as the provider stores and returns it. */
export interface BookingRecord {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	passportNumber: string;
	status: string;
	flightIds: string[];
	createdAt: Date;
}

/** A record read back from the ledger, or the caller's own copy of one. */
export interface BookingRecordSource {
	record: BookingRecord;
	/**
	 * True when the record was read from the durable ledger.
	 *
	 * A caller holding a booking that was never persisted has to behave the way
	 * the pre-ledger provider did — answer from what this process happens to
	 * know — because there is genuinely nothing else to consult.
	 */
	durable: boolean;
}

/**
 * Reasons a ledger call has already been reported.
 *
 * Pinned to `globalThis` for the same reason the provider's store is: Next.js
 * reloads route modules in development, and a module-level set would let one
 * broken request produce a fresh log line on every subsequent edit.
 */
const REPORTED_KEY = Symbol.for("flynext.afs.ledger.reported");

function reported(): Set<string> {
	const host = globalThis as unknown as Record<symbol, Set<string> | undefined>;
	let set = host[REPORTED_KEY];
	if (set === undefined) {
		set = new Set<string>();
		host[REPORTED_KEY] = set;
	}
	return set;
}

/**
 * Record that the ledger could not be used, once per distinct reason.
 *
 * A missing table (`P2021`) and an unreachable database (`P1001`) are different
 * problems with different fixes, so they are reported separately rather than
 * collapsed into "the ledger is down".
 */
function noteFailure(operation: string, error: unknown): void {
	const code =
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code: unknown }).code)
			: "unknown";
	const reason = `${operation}:${code}`;
	const seen = reported();
	if (seen.has(reason)) {
		return;
	}
	seen.add(reason);
	reportEvent("afs.ledger.unavailable", {
		operation,
		code,
	});
}

/**
 * True when a `DATABASE_URL` is configured at all.
 *
 * Read per call rather than captured at module scope: the integration suite
 * swaps the environment between cases, and a value frozen at import time would
 * be whichever one happened to be first.
 */
function configured(): boolean {
	const url = process.env.DATABASE_URL?.trim();
	return url !== undefined && url.length > 0;
}

/**
 * True when this process can be expected to persist a booking.
 *
 * The caller uses this to decide whether the absence of a record means "no such
 * booking" or "written somewhere this process cannot see". Without a configured
 * database there is no shared store, so a not-found really is not-found.
 */
export function isDurable(): boolean {
	return configured();
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Narrow a stored `Json` column into the id list it is supposed to hold. */
function readFlightIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((entry): entry is string => typeof entry === "string");
}

/** The row shape every read below selects. */
const ROW_SELECT = {
	id: true,
	firstName: true,
	lastName: true,
	email: true,
	passportNumber: true,
	status: true,
	flightIds: true,
	createdAt: true,
} as const;

interface BookingRow {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	passportNumber: string;
	status: string;
	flightIds: unknown;
	createdAt: Date;
}

function toRecord(row: BookingRow): BookingRecord {
	return {
		id: row.id,
		firstName: row.firstName,
		lastName: row.lastName,
		email: row.email,
		passportNumber: row.passportNumber,
		status: String(row.status),
		flightIds: readFlightIds(row.flightIds),
		createdAt: row.createdAt,
	};
}

/**
 * Read one booking by its id.
 *
 * @returns the stored record, or `undefined` when the ledger has no such row —
 *   including when it could not be read at all, which the caller distinguishes
 *   with {@link isDurable}.
 */
export async function readBooking(id: string): Promise<BookingRecord | undefined> {
	try {
		const row = await prisma.afsOfflineBooking.findUnique({
			where: { id },
			select: ROW_SELECT,
		});
		return row === null ? undefined : toRecord(row);
	} catch (error) {
		noteFailure("read", error);
		throw badGateway("Flight booking ledger is temporarily unavailable");
	}
}

/**
 * How many live bookings contain each of `flightIds`.
 *
 * This is the flight's sold-seat count: a booking claims one seat on every leg,
 * and a cancellation moves the row to `CANCELLED` rather than deleting it, so
 * the live rows are exactly the seats that are still taken. Counting here rather
 * than keeping a per-flight counter is what makes the count correct on an
 * instance that never saw the booking.
 *
 * One statement for the whole list. The column is a JSON array, so membership is
 * asked with `@>` against a one-element array; expressing it as a join against
 * `unnest` is what keeps a day's worth of flights — several thousand of them,
 * which is what a search asks about — to one round trip rather than thousands.
 *
 * @returns a map of flight id to seats sold, omitting flights with none.
 */
export async function soldSeats(
	flightIds: readonly string[]
): Promise<Map<string, number>> {
	const sold = new Map<string, number>();
	const wanted = [...new Set(flightIds)];
	if (wanted.length === 0) {
		return sold;
	}

	try {
		const rows = await prisma.$queryRaw<{ flightId: string; seats: bigint }[]>`
			SELECT leg.id AS "flightId", count(*) AS seats
			FROM "AfsOfflineBooking" AS booking
			CROSS JOIN LATERAL (
				SELECT DISTINCT jsonb_array_elements_text(booking."flightIds") AS id
			) AS leg
			WHERE booking.status = 'CONFIRMED'::"BookingStatus" AND leg.id = ANY(${wanted}::text[])
			GROUP BY leg.id
		`;
		for (const row of rows) {
			const seats = Number(row.seats);
			if (seats > 0) {
				sold.set(row.flightId, seats);
			}
		}
	} catch (error) {
		noteFailure("sold-seats", error);
		throw badGateway("Flight inventory is temporarily unavailable");
	}
	return sold;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/** The statuses a stored booking can be moved to. */
export type LedgerStatus = "CONFIRMED" | "CANCELLED";

/** Persist cancellation while holding the same ordered flight locks as booking. */
export async function setStatus(
	id: string,
	status: LedgerStatus
): Promise<boolean> {
	try {
		return await prisma.$transaction(async tx => {
			const row = await tx.afsOfflineBooking.findUnique({ where: { id } });
			if (!row) return false;
			for (const flightId of readFlightIds(row.flightIds).sort()) {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flight:${flightId}`}, 0))`;
			}
			const changed = await tx.afsOfflineBooking.updateMany({ where: { id }, data: { status } });
			return changed.count === 1;
		}, DEFAULT_TRANSACTION_OPTIONS);
	} catch (error) {
		noteFailure("set-status", error);
		return false;
	}
}

export async function claimSeatsAndWrite(record: BookingRecord, capacities: ReadonlyMap<string, number>): Promise<Map<string, number>> {
	if (!configured()) throw badGateway("Flight booking requires a durable ledger");
	return prisma.$transaction(async tx => {
		const remaining = new Map<string, number>();
		for (const id of [...capacities.keys()].sort()) {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flight:${id}`}, 0))`;
		}
		for (const [id, capacity] of capacities) {
			const sold = await tx.afsOfflineBooking.count({ where: { status: "CONFIRMED", flightIds: { array_contains: [id] } } });
			if (sold >= capacity) throw badRequest(`No available seats on flight ${id}`);
			remaining.set(id, capacity - sold - 1);
		}
		await tx.afsOfflineBooking.create({ data: { ...record, status: "CONFIRMED" } });
		return remaining;
	}, DEFAULT_TRANSACTION_OPTIONS);
}

/**
 * Forget the reported failures. Test seam — production must not call this.
 *
 * A suite that drives the ledger's degraded path deliberately would otherwise
 * silence the next case's genuine failure, because the dedup key is a reason
 * rather than a call site.
 */
export function resetLedgerReporting(): void {
	reported().clear();
}
