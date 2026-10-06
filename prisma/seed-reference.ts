/**
 * Production reference-data seed.
 *
 * `prisma/seed.ts` is a demo/reset fixture: it truncates most of the schema
 * and rebuilds 50 demo users, hotels, bookings and itineraries from
 * `prisma/generate_data.sql`. That is what a course demo wants and what a
 * production database must never receive, so the two jobs are two scripts.
 *
 * This is the production one. It adds only the rows the application cannot run
 * without:
 *
 *   - `City` and `Airport`, because flight and hotel search start from the
 *     location autocomplete (`/api/locations/cities`, `/api/locations/airports`);
 *   - `Hotel` and `RoomType`, so the hotel pages have something to show;
 *   - one hotel-owner account, because `Hotel.ownerId` is what grants management
 *     rights (`/api/hotels/owner`, `/api/hotels/[hotelId]/room-types`). Without an
 *     owner the reference hotels would be listed to everyone and editable by
 *     nobody, including the deployer.
 *
 * Four properties the script has to keep:
 *
 * 1. It never deletes. No `TRUNCATE`, no `deleteMany`. It only creates what is
 *    missing, so it is safe to run against a database that already holds real
 *    users, hotels and reservations. It never touches `User` rows other than the
 *    operator account below, and never creates a reservation, itinerary or
 *    notification.
 *
 * 2. It is idempotent. Cities are matched by name, airports by `externalId`/`code`,
 *    hotels and room types by name, and the operator account is reused rather than
 *    recreated. A second run reports zero inserts.
 *
 * 3. The operator password is generated, printed once, and never stored anywhere
 *    else. Set `SEED_OWNER_PASSWORD` to choose it yourself (the script then never
 *    prints it, and re-running with the same value keeps it in sync).
 *
 * 4. Fixture paths must not depend on the working directory; they are resolved by
 *    `prisma/seed-fixtures.ts`, which is what makes the compiled
 *    `dist/prisma/seed-reference.js` runnable.
 */

import { randomBytes } from "crypto";
import path from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { availabilityHorizon } from "../lib/api/validation";
import { hashPassword } from "../lib/auth";
import {
	readSeedJson,
	type SeedAirport,
	type SeedCity,
} from "./seed-fixtures";

const prisma = new PrismaClient();

/** Where the operator account lives unless `SEED_OWNER_EMAIL` overrides it. */
const DEFAULT_OWNER_EMAIL = "hotel-owner@flynext.local";

/** Room types created per reference hotel. */
const ROOM_TYPES_PER_HOTEL = 2;

/** Logo every reference hotel points at; a static asset in `public/`. */
const HOTEL_LOGO = "/hotel-logo-default.svg";

/**
 * Budget for the whole seed. It is a handful of round trips, but the database is
 * remote in the documented deployment, so Prisma's five-second default is tight.
 */
const REFERENCE_TRANSACTION_TIMEOUT_MS = 2 * 60 * 1000;

/** What the operator account looked like after this run. */
interface OwnerAccount {
	id: number;
	email: string;
	outcome: "created" | "password-reset" | "reused";
	/**
	 * The generated password, and only ever a generated one: an operator-supplied
	 * `SEED_OWNER_PASSWORD` is deliberately not echoed back into the log.
	 */
	generatedPassword: string | null;
}

/** Insert counts, for the closing report. */
interface ReferenceReport {
	citiesCreated: number;
	citiesTotal: number;
	airportsCreated: number;
	airportsTotal: number;
	hotelsCreated: number;
	hotelsTotal: number;
	roomTypesCreated: number;
	roomTypesTotal: number;
	/** Nights added to room-type calendars; `0` on a second run. */
	availabilityNightsCreated: number;
	owner: OwnerAccount;
}

/**
 * Generate the operator password.
 *
 * base64url of 12 random bytes: 16 characters, ~96 bits of entropy, and safe to
 * retype from a terminal (no shell or URL metacharacters).
 */
function generateOwnerPassword(): string {
	return randomBytes(12).toString("base64url");
}

/**
 * Find or create the hotel-owner account the reference hotels belong to.
 *
 * The lookup mirrors `POST /api/auth/login`: exact match first, then
 * case-insensitive, because a hand-edited row may carry a different spelling.
 */
async function ensureOwnerAccount(
	tx: Prisma.TransactionClient
): Promise<OwnerAccount> {
	const email = (process.env.SEED_OWNER_EMAIL ?? DEFAULT_OWNER_EMAIL)
		.trim()
		.toLowerCase();
	const requested = process.env.SEED_OWNER_PASSWORD;

	const existing =
		(await tx.user.findUnique({ where: { email } })) ??
		(await tx.user.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
		}));

	if (existing !== null) {
		if (requested === undefined) {
			// Deliberately no password write: a stored password may have been changed
			// on purpose, and silently replacing it would lock the operator out.
			return {
				id: existing.id,
				email,
				outcome: "reused",
				generatedPassword: null,
			};
		}
		await tx.user.update({
			where: { id: existing.id },
			data: { password: await hashPassword(requested), IsHotelOwner: true },
		});
		return { id: existing.id, email, outcome: "password-reset", generatedPassword: null };
	}

	const generatedPassword = requested ?? generateOwnerPassword();
	const created = await tx.user.create({
		data: {
			email,
			password: await hashPassword(generatedPassword),
			firstName: "Hotel",
			lastName: "Owner",
			IsHotelOwner: true,
		},
		select: { id: true },
	});

	return {
		id: created.id,
		email,
		outcome: "created",
		generatedPassword: requested === undefined ? generatedPassword : null,
	};
}

/**
 * Create every fixture city that is missing, and index all cities by name.
 *
 * `createMany({ skipDuplicates: true })` cannot do this alone: it relies on a
 * unique constraint, and `City.name` has none. The comparison therefore happens
 * in memory, which also keeps a re-run free of stray rows.
 */
async function ensureCities(
	tx: Prisma.TransactionClient,
	fixture: SeedCity[]
): Promise<{ created: number; byName: Map<string, number> }> {
	const existing = await tx.city.findMany({ select: { id: true, name: true } });
	const byName = new Map(existing.map((row) => [row.name, row.id]));
	const missing = fixture.filter((city) => !byName.has(city.city));

	if (missing.length > 0) {
		await tx.city.createMany({
			data: missing.map((city) => ({ name: city.city, country: city.country })),
		});
		// `createMany` does not return the generated ids, so they are read back.
		byName.clear();
		for (const row of await tx.city.findMany({
			select: { id: true, name: true },
		})) {
			byName.set(row.name, row.id);
		}
	}

	return { created: missing.length, byName };
}

/** Create every fixture airport that is missing, keyed by `externalId`/`code`. */
async function ensureAirports(
	tx: Prisma.TransactionClient,
	fixture: SeedAirport[],
	cityNameToId: Map<string, number>
): Promise<number> {
	const existing = await tx.airport.findMany({
		select: { externalId: true, code: true },
	});
	const knownExternalIds = new Set(existing.map((row) => row.externalId));
	const knownCodes = new Set(existing.map((row) => row.code));

	// Either key being known means the row is already there: `externalId` is the
	// AFS id and `code` the IATA code, and both are unique in the schema.
	const missing = fixture.filter(
		(airport) =>
			!knownExternalIds.has(airport.id) && !knownCodes.has(airport.code)
	);
	if (missing.length === 0) {
		return 0;
	}

	await tx.airport.createMany({
		data: missing.map((airport) => {
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
		// A concurrent deploy could have inserted one of these already.
		skipDuplicates: true,
	});

	return missing.length;
}

/**
 * Create the reference hotels — one per fixture city — and their room types.
 *
 * The shape mirrors the demo fixture: hotel `n` sits in city `n`, rates
 * `(n % 5) + 1` stars, and carries `Room Type <hotelId>-1..2`. The count does not
 * match the demo, and is not meant to: `generate_data.sql` hardcodes only the
 * first 50 cities, while this script follows `seed_data/cities.json` (81 today),
 * so a reference-seeded database has browsable content for every city it knows.
 *
 * Hotels are matched by name alone. A real hotel owner is free to create a row
 * named "Hotel 5", and the safe reaction is to leave it alone rather than adopt
 * it (which would hand their hotel to the operator account) or duplicate it.
 */
async function ensureHotels(
	tx: Prisma.TransactionClient,
	ownerId: number,
	cities: SeedCity[]
): Promise<{
	hotelsCreated: number;
	roomTypesCreated: number;
	availabilityNightsCreated: number;
}> {
	const wanted = cities.map((city, index) => {
		const ordinal = index + 1;
		return {
			name: `Hotel ${ordinal}`,
			address: `Address ${ordinal}`,
			location: `${city.city}, ${city.country}`,
			starRating: (ordinal % 5) + 1,
		};
	});
	const names = wanted.map((hotel) => hotel.name);

	const existing = await tx.hotel.findMany({
		where: { name: { in: names } },
		select: { id: true, name: true },
	});
	let idByName = new Map(existing.map((row) => [row.name, row.id]));
	const missing = wanted.filter((hotel) => !idByName.has(hotel.name));

	if (missing.length > 0) {
		await tx.hotel.createMany({
			data: missing.map((hotel) => ({
				...hotel,
				logo: HOTEL_LOGO,
				images: [],
				ownerId,
			})),
		});
		// Room type names embed the hotel id, which `createMany` does not return.
		for (const row of await tx.hotel.findMany({
			where: { name: { in: missing.map((hotel) => hotel.name) } },
			select: { id: true, name: true },
		})) {
			idByName.set(row.name, row.id);
		}
	}

	const hotelIds = wanted.map((hotel) => {
		const id = idByName.get(hotel.name);
		if (id === undefined) {
			// Unreachable unless the insert above silently dropped a row.
			throw new Error(`Reference hotel "${hotel.name}" is missing after the create pass.`);
		}
		return id;
	});

	const existingRoomTypes = await tx.roomType.findMany({
		where: { hotelId: { in: hotelIds } },
		select: { hotelId: true, name: true },
	});
	const knownRoomTypes = new Set(
		existingRoomTypes.map((row) => `${row.hotelId}:${row.name}`)
	);

	const roomTypes: Prisma.RoomTypeCreateManyInput[] = [];
	for (const hotelId of hotelIds) {
		for (let index = 1; index <= ROOM_TYPES_PER_HOTEL; index += 1) {
			const name = `Room Type ${hotelId}-${index}`;
			if (knownRoomTypes.has(`${hotelId}:${name}`)) {
				continue;
			}
			roomTypes.push({
				name,
				amenities: "Amenity1, Amenity2",
				pricePerNight: 100 + 10 * (hotelId * 2 + index),
				images: [],
				currentAvailability: 10 + (hotelId * 2 + index),
				hotelId,
			});
		}
	}
	if (roomTypes.length > 0) {
		await tx.roomType.createMany({ data: roomTypes });
	}

	/*
	 * Materialise the booking calendar for every reference room type.
	 *
	 * A booking claims one `RoomAvailabilityRecord` per night and is refused with
	 * "The selected date is not supported for booking." when a night has no row,
	 * so a room type seeded without its calendar is listed on the hotel page but
	 * cannot actually be booked. Only missing nights are inserted, which keeps this
	 * compatible with the script's "never deletes, only creates" contract and makes
	 * a second run a no-op.
	 */
	const seededRoomTypes = await tx.roomType.findMany({
		where: { hotelId: { in: hotelIds } },
		select: { id: true, currentAvailability: true },
	});
	const { days } = availabilityHorizon();
	const knownNights = new Set(
		(
			await tx.roomAvailabilityRecord.findMany({
				where: { roomTypeId: { in: seededRoomTypes.map((row) => row.id) } },
				select: { roomTypeId: true, date: true },
			})
		).map((row) => `${row.roomTypeId}:${row.date.getTime()}`)
	);
	const nights: Prisma.RoomAvailabilityRecordCreateManyInput[] =
		seededRoomTypes.flatMap((roomType) =>
			days
				.filter((day) => !knownNights.has(`${roomType.id}:${day.getTime()}`))
				.map((day) => ({
					roomTypeId: roomType.id,
					date: day,
					availability: roomType.currentAvailability,
				}))
		);
	if (nights.length > 0) {
		await tx.roomAvailabilityRecord.createMany({
			data: nights,
			skipDuplicates: true,
		});
	}

	return {
		hotelsCreated: missing.length,
		roomTypesCreated: roomTypes.length,
		availabilityNightsCreated: nights.length,
	};
}

async function main(): Promise<void> {
	const cities = readSeedJson<SeedCity[]>(path.join("seed_data", "cities.json"));
	const airports = readSeedJson<SeedAirport[]>(
		path.join("seed_data", "airports.json")
	);

	// One transaction per run: the steps build on each other (airports need the
	// city ids, room types need the hotel ids), and a failure should leave the
	// database exactly as it was rather than half-seeded.
	const report = await prisma.$transaction(
		async (tx): Promise<ReferenceReport> => {
			const owner = await ensureOwnerAccount(tx);
			const cityResult = await ensureCities(tx, cities);
			const airportsCreated = await ensureAirports(tx, airports, cityResult.byName);
			const hotelResult = await ensureHotels(tx, owner.id, cities);

			return {
				citiesCreated: cityResult.created,
				citiesTotal: await tx.city.count(),
				airportsCreated,
				airportsTotal: await tx.airport.count(),
				hotelsCreated: hotelResult.hotelsCreated,
				hotelsTotal: await tx.hotel.count(),
				roomTypesCreated: hotelResult.roomTypesCreated,
				roomTypesTotal: await tx.roomType.count(),
				availabilityNightsCreated: hotelResult.availabilityNightsCreated,
				owner,
			};
		},
		{ timeout: REFERENCE_TRANSACTION_TIMEOUT_MS }
	);

	console.log("Reference data seeded (nothing was deleted).");
	console.log(
		`  cities      ${report.citiesTotal} total, ${report.citiesCreated} created`
	);
	console.log(
		`  airports    ${report.airportsTotal} total, ${report.airportsCreated} created`
	);
	console.log(
		`  hotels      ${report.hotelsTotal} total, ${report.hotelsCreated} created`
	);
	console.log(
		`  room types  ${report.roomTypesTotal} total, ${report.roomTypesCreated} created`
	);
	console.log(
		`  calendar    ${report.availabilityNightsCreated} availability night(s) created`
	);

	const { email, outcome, generatedPassword } = report.owner;
	if (outcome === "created") {
		console.log(`  owner       ${email} created`);
	} else if (outcome === "password-reset") {
		console.log(`  owner       ${email} existed; password reset from SEED_OWNER_PASSWORD`);
	} else {
		console.log(`  owner       ${email} existed; password left unchanged`);
	}
	if (generatedPassword !== null) {
		console.log("");
		console.log(`  Hotel-owner password: ${generatedPassword}`);
		console.log(
			"  Save it now. It is printed once and is not stored anywhere in plaintext."
		);
	}
}

main()
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
