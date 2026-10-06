/**
 * Database seed script.
 *
 * Run with `npm run seed` (via `tsx`), which is also what `prisma db seed` uses.
 * After `npm run build:server` the compiled `dist/prisma/seed.js` is runnable
 * with plain `node`.
 *
 * Three properties the script has to keep:
 *
 * 1. Demo passwords must end up hashed. `prisma/generate_data.sql` inserts the
 *    demo users' passwords as plaintext (`'password1'`), while `POST
 *    /api/auth/login` verifies them with bcrypt. `bcrypt.compare("password1",
 *    "password1")` is always `false`, so without this pass all 50 demo accounts
 *    reject every login attempt with "Invalid password" and nothing anywhere
 *    reports an error. Any stored password that is not already a bcrypt hash is
 *    hashed in place, which makes the step idempotent.
 *
 * 2. Fixture paths must not depend on the working directory. The JSON fixtures
 *    and the SQL file are read through one resolver (`prisma/seed-fixtures.ts`)
 *    that searches the likely locations, so the script works under `tsx`, under
 *    `node dist/prisma/seed.js`, and from any cwd.
 *
 * 3. Raw SQL is never built from input. The only raw SQL is
 *    `prisma/generate_data.sql`, read from disk, split into statements by
 *    `splitSqlStatements`, and handed to `$executeRawUnsafe` verbatim. Nothing
 *    derived from a request may ever reach those calls.
 *
 * 4. Each statement is sent on its own. `$executeRawUnsafe` goes through the
 *    extended query protocol, which parses exactly one statement per call, so
 *    feeding it a whole multi-statement script fails with SQLSTATE 42601
 *    ("cannot insert multiple commands into a prepared statement"). See
 *    `splitSqlStatements` in `prisma/sql-script.ts` — shared with the test
 *    bootstrap — for why the split cannot be a plain `split(";")`.
 *
 * 5. Every seeded room type must end up bookable. `generate_data.sql` inserts
 *    `RoomType` rows and no `RoomAvailabilityRecord` rows at all, while
 *    `POST /api/hotels/book` requires one availability row per night of the stay
 *    and answers `400 "The selected date is not supported for booking."` when a
 *    night has none. Seeding without materialising the calendar therefore leaves
 *    a catalogue in which every hotel booking fails. The materialisation pass
 *    below closes that, and is idempotent so a re-run is harmless.
 *
 * This script is a demo/reset fixture: it clears the tables it owns and rebuilds
 * 50 demo users, hotels, bookings and itineraries. It must not be run against a
 * database holding real data. Production gets `prisma/seed-reference.ts`
 * instead, which only adds the reference rows.
 */

import path from "path";
import { PrismaClient } from "@prisma/client";
import { availabilityHorizon } from "../lib/api/validation";
import { hashPassword } from "../lib/auth";
import { firstLine, splitSqlStatements } from "./sql-script";
import {
	readSeedJson,
	readSeedSql,
	type SeedAirport,
	type SeedCity,
} from "./seed-fixtures";

const prisma = new PrismaClient();

/** Matches a bcrypt hash so already-hashed rows are left untouched. */
const BCRYPT_HASH_PATTERN = /^\$2[aby]?\$\d{2}\$/;

async function seedCities(): Promise<Map<string, number>> {
	const cities = readSeedJson<SeedCity[]>(path.join("seed_data", "cities.json"));

	await prisma.city.createMany({
		data: cities.map((city) => ({
			name: city.city,
			country: city.country,
		})),
	});

	// `createMany` does not return the generated ids, so they are read back and
	// indexed by name for the airport pass.
	const records = await prisma.city.findMany({ select: { id: true, name: true } });
	return new Map(records.map((record) => [record.name, record.id]));
}

async function seedAirports(cityNameToId: Map<string, number>): Promise<void> {
	const airports = readSeedJson<SeedAirport[]>(path.join("seed_data", "airports.json"));

	await prisma.airport.createMany({
		data: airports.map((airport) => {
			const cityId = cityNameToId.get(airport.city);
			if (cityId === undefined) {
				throw new Error(
					`Airport ${airport.code} references unknown city "${airport.city}"`
				);
			}
			return {
				externalId: airport.id,
				code: airport.code,
				name: airport.name,
				cityId,
				country: airport.country,
			};
		}),
	});
}

/**
 * Hash any user password still stored in plaintext.
 *
 * Idempotent: rows already holding a bcrypt hash are skipped, because their
 * plaintext is unrecoverable and re-hashing a hash would lock the account.
 *
 * @returns the number of passwords upgraded.
 */
async function hashPlaintextPasswords(): Promise<number> {
	const users = await prisma.user.findMany({
		select: { id: true, password: true },
	});

	let upgraded = 0;
	for (const user of users) {
		if (BCRYPT_HASH_PATTERN.test(user.password)) {
			continue;
		}
		await prisma.user.update({
			where: { id: user.id },
			data: { password: await hashPassword(user.password) },
		});
		upgraded += 1;
	}
	return upgraded;
}

/**
 * Budget for the transaction that replays `generate_data.sql`.
 *
 * Prisma's default is five seconds, which is not enough for the ~100 statements
 * the fixture holds once the database is remote (all of them are round trips
 * inside one interactive transaction).
 */
const SQL_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run every statement of `generate_data.sql`, one call per statement.
 *
 * The statements are replayed inside a single transaction: the fixture opens by
 * truncating most of the schema, and a failure half-way through would otherwise
 * leave the database emptied rather than untouched.
 *
 * @returns the number of statements executed.
 */
async function executeSqlStatements(statements: string[]): Promise<number> {
	await prisma.$transaction(
		async (tx) => {
			// The fixture legitimately runs longer than a request would.
			await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 0");

			for (let index = 0; index < statements.length; index += 1) {
				const statement = statements[index];
				try {
					// One statement only: `splitSqlStatements` guarantees it.
					await tx.$executeRawUnsafe(statement);
				} catch (error) {
					throw new Error(
						`generate_data.sql statement ${index + 1} of ${statements.length} failed: ` +
							`${firstLine(statement)}`,
						{ cause: error }
					);
				}
			}
		},
		{ timeout: SQL_TRANSACTION_TIMEOUT_MS }
	);

	return statements.length;
}

/**
 * Give every seeded room type the availability rows a booking needs.
 *
 * `generate_data.sql` creates `RoomType` rows with a `currentAvailability`
 * figure and no per-night rows. The per-night rows are what a booking claims:
 * `POST /api/hotels/book` counts the rows covering the stay and refuses the
 * request outright when any night is missing one, so without this pass every
 * hotel booking against the demo fixture failed with
 * "The selected date is not supported for booking."
 *
 * Idempotent by construction: the nights that already exist are read first and
 * only the gaps are inserted, so a second run inserts nothing.
 *
 * @returns how many nights were created across all room types.
 */
async function seedRoomAvailability(): Promise<number> {
	const { days } = availabilityHorizon();
	const roomTypes = await prisma.roomType.findMany({
		select: { id: true, currentAvailability: true },
	});
	if (roomTypes.length === 0 || days.length === 0) {
		return 0;
	}

	const existing = await prisma.roomAvailabilityRecord.findMany({
		where: { roomTypeId: { in: roomTypes.map((roomType) => roomType.id) } },
		select: { roomTypeId: true, date: true },
	});
	const filled = new Set(
		existing.map((row) => `${row.roomTypeId}:${row.date.getTime()}`)
	);

	const rows = roomTypes.flatMap((roomType) =>
		days
			.filter((day) => !filled.has(`${roomType.id}:${day.getTime()}`))
			.map((day) => ({
				roomTypeId: roomType.id,
				date: day,
				availability: roomType.currentAvailability,
			}))
	);
	if (rows.length === 0) {
		return 0;
	}

	// Chunked so one statement never carries tens of thousands of rows.
	const CHUNK = 1_000;
	for (let index = 0; index < rows.length; index += CHUNK) {
		await prisma.roomAvailabilityRecord.createMany({
			data: rows.slice(index, index + CHUNK),
			skipDuplicates: true,
		});
	}
	return rows.length;
}

async function main(): Promise<void> {
	// Airports reference cities, so children are cleared first.
	await prisma.$transaction([
		prisma.airport.deleteMany(),
		prisma.city.deleteMany(),
	]);

	const cityNameToId = await seedCities();
	await seedAirports(cityNameToId);

	// Demo hotels, room types, reservations and itineraries. The fixture is a
	// multi-statement script, so it is split and replayed statement by statement.
	// Static, repository-owned SQL. Never pass request-derived text here.
	const statements = splitSqlStatements(readSeedSql("generate_data.sql"));
	const executed = await executeSqlStatements(statements);
	console.log(
		`Additional SQL data seeded successfully (${executed} statements from generate_data.sql).`
	);

	const upgraded = await hashPlaintextPasswords();
	console.log(`Hashed ${upgraded} plaintext password(s).`);

	// Without this, the demo room types exist but cannot be booked for any date.
	const nights = await seedRoomAvailability();
	console.log(`Materialised ${nights} room-availability night(s).`);
}

main()
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
