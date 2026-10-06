/**
 * Durable state for the in-process AFS provider.
 *
 * `lib/afs/offline.ts` is a substitute for a separate service, and a real service
 * keeps its bookings somewhere every instance can read. This process's memory is
 * not that place: on a serverless host a search and the booking that follows it
 * are usually two invocations, often on two workers, so a booking held only in
 * memory is "Booking not found" for the next request — which is precisely the
 * failure this table removes.
 *
 * What lives here and what does not is deliberate:
 *
 * - Bookings are durable. They are the only thing a later request has to find
 *   again, so they are written before the provider answers and read back by id
 *   afterwards. `retrieve` and `cancel` then work from any instance, and a
 *   cancellation is idempotent across all of them: the release is driven by the
 *   stored status rather than by a local flag.
 * - Seat inventory is derived, not stored. A flight's live count is its default
 *   minus the bookings that contain it, so two instances cannot each sell the
 *   last seat from their own private counter — and there is no second copy of
 *   the truth to drift.
 *
 * ## Degrading rather than failing
 *
 * Every function here answers `undefined`/`0` when the database is unreachable,
 * and logs once per reason. A provider that answered a search but refused every
 * booking because a ledger write timed out would be worse than one that keeps the
 * pre-existing in-memory behaviour, and the caller cannot tell the difference
 * anyway — {@link isDurable} is what it uses to decide whether a fallback is
 * safe. The failure is reported once, in the log the rest of the API already
 * writes to, instead of on every call.
 *
 * ## Relative imports
 *
 * As in `lib/afs/offline.ts`: `tsconfig.server.json` compiles this tree to `dist/`
 * as plain CommonJS for `node dist/prisma/seed.js`, and an aliased import would
 * emit a `require("@/…")` that Node cannot resolve.
 */

import { prisma } from "../prisma";
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
		detail: error instanceof Error ? error.message : String(error),
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
		return undefined;
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
			SELECT wanted."flightId" AS "flightId",
			       (
			         SELECT count(*)
			         FROM "AfsOfflineBooking" AS booking
			         WHERE booking."status" = 'CONFIRMED'::"BookingStatus"
			           AND booking."flightIds" @> to_jsonb(ARRAY[wanted."flightId"])
			       ) AS "seats"
			FROM unnest(${wanted}::text[]) AS wanted("flightId")
		`;
		for (const row of rows) {
			const seats = Number(row.seats);
			if (seats > 0) {
				sold.set(row.flightId, seats);
			}
		}
	} catch (error) {
		noteFailure("sold-seats", error);
	}
	return sold;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Persist a booking, or report that it could not be.
 *
 * @returns `true` when the row is stored. The caller keeps its in-memory copy
 *   either way; the answer only decides whether it may also promise that a later
 *   request — on any instance — will find this booking.
 */
export async function writeBooking(record: BookingRecord): Promise<boolean> {
	try {
		await prisma.afsOfflineBooking.create({
			data: {
				id: record.id,
				firstName: record.firstName,
				lastName: record.lastName,
				email: record.email,
				passportNumber: record.passportNumber,
				status: "CONFIRMED",
				flightIds: record.flightIds,
			},
		});
		return true;
	} catch (error) {
		noteFailure("write", error);
		return false;
	}
}

/** The statuses a stored booking can be moved to. */
export type LedgerStatus = "CONFIRMED" | "CANCELLED";

/**
 * Move a stored booking to `status`.
 *
 * `updateMany` rather than `update`: a cancellation has to be idempotent even
 * against a row that has already gone, and `update` would raise `P2025` for a
 * booking another instance is concurrently cancelling. Matching zero rows is a
 * successful no-op, exactly as a repeated cancellation already is in memory.
 */
export async function setStatus(
	id: string,
	status: LedgerStatus
): Promise<boolean> {
	try {
		await prisma.afsOfflineBooking.updateMany({ where: { id }, data: { status } });
		return true;
	} catch (error) {
		noteFailure("set-status", error);
		return false;
	}
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
