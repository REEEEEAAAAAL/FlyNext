#!/usr/bin/env node
/**
 * Repair flight reservations whose direction columns hold a legacy record shape.
 *
 * A `FlightReservation` stores its itinerary in two JSON columns, in the keys
 * `goDate` / `goAirport` / `returnDate` / `returnAirport`. They describe the two
 * directions flown — outbound and, for a round trip, the way home. A row that
 * predates the current writer does not say that: those columns were filled from
 * the first two legs of the ticket, whatever those legs were. Two shapes are
 * therefore ambiguous on their face:
 *
 * - a one-way ticket with a connection (`YYZ→HKG→CAN`) reads as an outbound
 *   `YYZ→HKG` plus a "return" `HKG→CAN`, so the booking history renders its two
 *   legs as two directions, and
 * - a round trip with a connection on each half reads the same way, so its
 *   outbound appears twice and the way home never.
 *
 * Current bookings are written correctly (see `buildFlightLegs` /
 * `splitFlightDirections` in `lib/reservations.ts`). This script rewrites the
 * rows that are not, using the same functions, and reports every change it makes.
 *
 * ## How the true itinerary is recovered
 *
 * The order the legs were flown in is what says where the outbound half ends, and
 * it is recoverable when the booking has a row in `AfsOfflineBooking` — the
 * offline provider's ledger stores the flight ids in order, and the provider can
 * still resolve them into legs. Those rows are rebuilt exactly, connections and
 * all.
 *
 * A row with no ledger entry (booked against a real AFS service, which keeps no
 * local ledger, or written before the ledger was available) is judged by the
 * columns themselves. They hold the first two flights of the ticket, so for a
 * one-way booking with a connection the "return" half is the second flight of the
 * same direction, and it proves it by leaving from exactly where the first
 * flight landed. Those rows are rebuilt as the one direction they really were —
 * both flights included, which is where their transfer airport comes from — and a
 * genuine round trip is left untouched. What cannot be recovered is a round trip's
 * way home when only the summary was kept: those values were never stored, and the
 * report says so rather than inventing them.
 *
 * ## Usage
 *
 * ```bash
 * npx tsx scripts/repair-flight-directions.ts                  # report only
 * npx tsx scripts/repair-flight-directions.ts --apply           # rewrite the rows
 * npx tsx scripts/repair-flight-directions.ts --restore         # undo the last --apply
 * ```
 *
 * `DATABASE_URL` is read from the environment, or from `.env` when it is not set.
 * Only the host and database name are ever printed. The default is a dry run:
 * nothing is written without `--apply`, and `--apply` writes a JSON backup of the
 * previous values to `repair-flight-directions.backup.json` first. `--restore`
 * puts those values back, so an `--apply` is always reversible — including when a
 * later revision of the recovery rule can read more out of the original columns
 * than the run that overwrote them did.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { retrieveBooking } from "../lib/afs-client";
import type { AfsFlight, FlightLegJson, FlightSegmentJson } from "../types";
import {
	buildFlightLegs,
	buildFlightLegsFromSegments,
	splitFlightDirections,
	type FlightDirections,
} from "../lib/reservations";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

/** Load `.env` into the process when `DATABASE_URL` is not already set. */
function loadEnvFile(): void {
	if (process.env.DATABASE_URL) {
		return;
	}
	let contents: string;
	try {
		contents = readFileSync(new URL("../.env", import.meta.url), "utf8");
	} catch {
		return;
	}
	for (const line of contents.split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (match === null) {
			continue;
		}
		const [, name, rawValue] = match;
		const value = rawValue!.trim().replace(/^["']|["']$/g, "");
		if (process.env[name!] === undefined && value.length > 0) {
			process.env[name!] = value;
		}
	}
}

/** The database being targeted, with the credentials removed. */
function describeTarget(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname}`;
	} catch {
		return "(unparseable DATABASE_URL)";
	}
}

/* -------------------------------------------------------------------------- */
/* Column shaping                                                             */
/* -------------------------------------------------------------------------- */

/** The two columns as they are stored, with every key present. */
interface StoredColumns {
	departure: FlightLegJson;
	arrival: FlightLegJson;
}

/** Read one column, tolerating a value that is not an object. */
function readLeg(value: unknown): FlightLegJson {
	const record =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const read = (key: string): string | null =>
		typeof record[key] === "string" && (record[key] as string).length > 0
			? (record[key] as string)
			: null;
	const readSegments = (key: string): FlightSegmentJson[] => {
		const list = record[key];
		if (!Array.isArray(list)) {
			return [];
		}
		return list.flatMap((entry) => {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
				return [];
			}
			const segment = entry as Record<string, unknown>;
			const field = (name: string): string | null =>
				typeof segment[name] === "string" && (segment[name] as string).length > 0
					? (segment[name] as string)
					: null;
			return [
				{
					from: field("from"),
					to: field("to"),
					departDate: field("departDate"),
					arriveDate: field("arriveDate"),
				},
			];
		});
	};
	return {
		goDate: read("goDate"),
		goAirport: read("goAirport"),
		returnDate: read("returnDate"),
		returnAirport: read("returnAirport"),
		goLegs: readSegments("goLegs"),
		returnLegs: readSegments("returnLegs"),
	};
}

/** True when a value is a real one rather than absent or the `" "` sentinel. */
function present(value: string | null): boolean {
	return value !== null && value.trim().length > 0;
}

/**
 * Recover the legs of a row written in the legacy record shape.
 *
 * That shape filled the columns from the first two flights of the ticket, so a
 * connecting one-way booking left the connection in the columns themselves: the
 * "return" half is the second flight of the outbound direction, and it proves it
 * by leaving from exactly where the first flight landed.
 *
 * @returns the legs of the single outbound direction, or `null` when the row is
 *   not that shape — a one-way booking with no connection, or a round trip whose
 *   return half really does come home.
 */
function recoverLegacyLegs(columns: StoredColumns): FlightSegmentJson[] | null {
	const { departure, arrival } = columns;

	// No return values: nothing was written twice, so there is nothing to undo.
	if (!present(departure.returnAirport) && !present(arrival.returnAirport)) {
		return null;
	}
	// The proof that the second half is a connection rather than a way home: it
	// leaves from where the first half landed. A return leaves from the
	// destination and lands at the origin, which no connection satisfies.
	if (departure.returnAirport !== arrival.goAirport) {
		return null;
	}
	// A return that lands where the trip started is a return. Leave it alone.
	if (arrival.returnAirport === departure.goAirport) {
		return null;
	}
	// The booking history and the itinerary pages read these together; half a leg
	// is not enough to rebuild a direction from.
	if (!present(arrival.returnDate) || !present(departure.returnDate)) {
		return null;
	}

	return [
		{
			from: departure.goAirport,
			to: arrival.goAirport,
			departDate: departure.goDate,
			arriveDate: arrival.goDate,
		},
		{
			from: departure.returnAirport,
			to: arrival.returnAirport,
			departDate: departure.returnDate,
			arriveDate: arrival.returnDate,
		},
	];
}

/** The columns a set of legs should be stored as. */
function columnsForSegments(outbound: readonly FlightSegmentJson[]): StoredColumns {
	return buildFlightLegsFromSegments({ outbound });
}

/** The columns a set of directions should be stored as. */
function columnsFor(directions: FlightDirections): StoredColumns {
	// `buildFlightLegs` writes `null` for an absent half; the columns are compared
	// as they are stored, so both sides go through the same shaping.
	return buildFlightLegs(directions);
}

/** True when two sets of columns hold the same values. */
function sameColumns(left: StoredColumns, right: StoredColumns): boolean {
	return (
		JSON.stringify(left.departure) === JSON.stringify(right.departure) &&
		JSON.stringify(left.arrival) === JSON.stringify(right.arrival)
	);
}

/* -------------------------------------------------------------------------- */
/* Repair                                                                     */
/* -------------------------------------------------------------------------- */

/** One row's outcome, for the report. */
interface Outcome {
	id: number;
	afsBookingId: string;
	source: "ledger" | "fallback" | "unchanged" | "skipped";
	detail: string;
	before?: StoredColumns;
	after?: StoredColumns;
}

const prisma = new PrismaClient();

async function repairRow(
	row: { id: number; afsBookingId: string; departure: unknown; arrival: unknown }
): Promise<Outcome> {
	const before: StoredColumns = {
		departure: readLeg(row.departure),
		arrival: readLeg(row.arrival),
	};

	/** The repair for a row whose true legs are known. */
	const repaired = (
		after: StoredColumns,
		source: Outcome["source"],
		detail: string
	): Outcome => ({
		id: row.id,
		afsBookingId: row.afsBookingId,
		source,
		detail,
		before,
		after,
	});

	const ledger = await prisma.afsOfflineBooking.findUnique({
		where: { id: row.afsBookingId },
	});

	if (ledger !== null) {
		// The provider is the authority on what was flown: the ledger holds the
		// flight ids in order, and `retrieveBooking` resolves them into legs.
		let legs: AfsFlight[] = [];
		try {
			legs = (await retrieveBooking(ledger.lastName, ledger.id)).flights;
		} catch (error) {
			return {
				id: row.id,
				afsBookingId: row.afsBookingId,
				source: "skipped",
				detail: `the provider could not resolve the booking: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}

		if (legs.length > 0) {
			const directions = splitFlightDirections(legs);
			return repaired(
				columnsFor(directions),
				"ledger",
				`${legs.length} legs, ${directions.inbound === undefined ? "one-way" : "round trip"}: ` +
					legs.map((leg) => `${leg.origin.code}>${leg.destination.code}`).join(" ")
			);
		}
		// Fall through to the stored columns: the ledger could not describe this
		// booking, so they are the only evidence of what was flown.
	}

	const recovered = recoverLegacyLegs(before);
	if (recovered === null) {
		return {
			id: row.id,
			afsBookingId: row.afsBookingId,
			source: "unchanged",
			detail:
				ledger === null
					? "no ledger entry, and the stored columns already describe directions"
					: "the provider reports no legs, and the stored columns already describe directions",
		};
	}

	return repaired(
		columnsForSegments(recovered),
		"fallback",
		`${ledger === null ? "no ledger entry" : "the provider reports no legs"}; ` +
			"the stored second half leaves from where the first landed, so it is the " +
			`second flight of one direction (via ${recovered[0]!.to ?? "?"})`
	);
}

/** Print one row's before/after in a form a human can check. */
function describeColumns(columns: StoredColumns): string {
	const one = (leg: FlightLegJson): string =>
		[
			`go ${leg.goAirport ?? "-"} ${leg.goDate ?? "-"}`,
			`return ${leg.returnAirport ?? "-"} ${leg.returnDate ?? "-"}`,
			`legs ${(leg.goLegs ?? []).map((s) => `${s.from ?? "?"}>${s.to ?? "?"}`).join(" ") || "-"}`,
			`return legs ${(leg.returnLegs ?? []).map((s) => `${s.from ?? "?"}>${s.to ?? "?"}`).join(" ") || "-"}`,
		].join(" | ");
	return `departure[${one(columns.departure)}] arrival[${one(columns.arrival)}]`;
}

async function main(): Promise<void> {
	loadEnvFile();

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("DATABASE_URL is not set, and .env does not define it.");
		process.exitCode = 1;
		return;
	}

	const apply = process.argv.includes("--apply");
	const restore = process.argv.includes("--restore");
	const backupPath = new URL(
		"../repair-flight-directions.backup.json",
		import.meta.url
	);

	if (restore) {
		await restoreBackup(backupPath);
		return;
	}

	console.log(
		`${apply ? "Repairing" : "Checking"} flight reservations in ${describeTarget(databaseUrl)}` +
			(apply ? "" : " (dry run — pass --apply to write)")
	);

	const rows = await prisma.flightReservation.findMany({
		orderBy: { id: "asc" },
		select: { id: true, afsBookingId: true, departure: true, arrival: true },
	});
	console.log(`${rows.length} reservation(s) to check\n`);

	const outcomes: Outcome[] = [];
	for (const row of rows) {
		outcomes.push(await repairRow(row));
	}

	const changed = outcomes.filter(
		(outcome) =>
			outcome.after !== undefined &&
			outcome.before !== undefined &&
			!sameColumns(outcome.before, outcome.after)
	);

	for (const outcome of outcomes) {
		const label = `#${outcome.id} ${outcome.afsBookingId.slice(0, 8)}…`;
		if (outcome.after === undefined || outcome.before === undefined) {
			console.log(`${label}  ${outcome.source}: ${outcome.detail}`);
			continue;
		}
		if (sameColumns(outcome.before, outcome.after)) {
			console.log(`${label}  unchanged (${outcome.source}): ${outcome.detail}`);
			continue;
		}
		console.log(`${label}  ${outcome.source}: ${outcome.detail}`);
		console.log(`    before  ${describeColumns(outcome.before)}`);
		console.log(`    after   ${describeColumns(outcome.after)}`);
	}

	console.log(`\n${changed.length} row(s) need repairing, ${outcomes.length - changed.length} do not`);

	if (changed.length === 0) {
		return;
	}
	if (!apply) {
		console.log("Nothing was written. Re-run with --apply to rewrite these rows.");
		return;
	}

	writeFileSync(
		backupPath,
		`${JSON.stringify(
			changed.map((outcome) => ({
				id: outcome.id,
				afsBookingId: outcome.afsBookingId,
				departure: outcome.before!.departure,
				arrival: outcome.before!.arrival,
			})),
			null,
			2
		)}\n`,
		"utf8"
	);

	let written = 0;
	for (const outcome of changed) {
		await prisma.flightReservation.update({
			where: { id: outcome.id },
			data: { departure: outcome.after!.departure, arrival: outcome.after!.arrival },
		});
		written += 1;
	}
	console.log(`Rewrote ${written} row(s). Previous values: ${fileURLToPath(backupPath)}`);
}

/** One entry of the backup file {@link main} writes before rewriting a row. */
interface BackupEntry {
	id: number;
	afsBookingId: string;
	departure: StoredColumns["departure"];
	arrival: StoredColumns["arrival"];
}

/**
 * Put back the values a previous `--apply` replaced.
 *
 * The columns are compared as they are stored, so a row already carrying the
 * backed-up values is left alone. The reverse operation is what keeps the repair
 * safe to repeat: the columns the legacy shape wrote hold more than the summary a
 * run rewrites them from — the flights of each direction, not just their ends —
 * and a run that consumed them needs to be undoable before they can be read
 * again.
 */
async function restoreBackup(backupPath: URL): Promise<void> {
	let entries: BackupEntry[];
	try {
		entries = JSON.parse(readFileSync(backupPath, "utf8")) as BackupEntry[];
	} catch {
		console.error(
			`No backup to restore: ${fileURLToPath(backupPath)} is missing or unreadable. ` +
				"A repair run writes it before it rewrites anything."
		);
		process.exitCode = 1;
		return;
	}

	console.log(`Restoring ${entries.length} row(s) from ${fileURLToPath(backupPath)}`);
	let restored = 0;
	for (const entry of entries) {
		const current = await prisma.flightReservation.findUnique({
			where: { id: entry.id },
			select: { departure: true, arrival: true },
		});
		if (current === null) {
			console.log(`#${entry.id}  no longer exists; skipped`);
			continue;
		}
		const columns: StoredColumns = {
			departure: readLeg(current.departure),
			arrival: readLeg(current.arrival),
		};
		const wanted: StoredColumns = {
			departure: readLeg(entry.departure),
			arrival: readLeg(entry.arrival),
		};
		if (sameColumns(columns, wanted)) {
			console.log(`#${entry.id}  already holds the backed-up values`);
			continue;
		}
		await prisma.flightReservation.update({
			where: { id: entry.id },
			data: { departure: wanted.departure, arrival: wanted.arrival },
		});
		restored += 1;
		console.log(`#${entry.id}  restored ${describeColumns(wanted)}`);
	}
	console.log(`Restored ${restored} row(s). Re-run with --apply to repair them again.`);
}

main()
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
