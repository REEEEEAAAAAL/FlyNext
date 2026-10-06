/**
 * Seed the local AFS database.
 *
 * The upstream project ships two data scripts (`prisma/data/import_data.js` and
 * `prisma/data/generate_flights.js`) that are meant to be run by hand. This file
 * does the same three jobs but is meant to be run from the container entrypoint,
 * which changes what it has to guarantee:
 *
 * - Idempotent: it is invoked on every container start. Airports, airlines and
 *   the agency are upserted, and flights are generated only for days that have
 *   none, so a restart neither duplicates rows nor skips days that passed while
 *   the container was down.
 * - Bookable: searches must return itineraries that can actually be booked. The
 *   upstream booking endpoint rejects a connection whose legs overlap, so the
 *   timetables below leave at least the same one-hour layover the search endpoint
 *   requires. A generated itinerary is therefore always purchasable.
 * - Bounded: a first run fills a seven-day window in a few seconds rather than
 *   the upstream's three months of dense traffic. Every later start extends the
 *   window, so the data grows with use instead of with a fixed cost.
 *
 * Determinism matters for the same reason it does in `lib/afs/offline.ts`: the
 * same route and day must produce the same flights, or a restart would silently
 * change the flights a caller has already been shown.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, FlightStatus } from "@prisma/client";

// Resolved relative to this file rather than to a fixed `/app` path, so the same
// script runs from the container entrypoint and from a checkout during
// development.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { airports } = require(
	join(here, "..", "prisma", "data", "airports.js")
);
const { airlines } = require(
	join(here, "..", "prisma", "data", "airlines.js")
);

const prisma = new PrismaClient();

/** Days of schedule to guarantee from today. Extended on every start. */
const WINDOW_DAYS = Number.parseInt(process.env.AFS_SEED_DAYS ?? "7", 10);

/** Share of airports each airline serves from its base. */
const DESTINATION_SHARE = 0.2;

/** Departure slots, in hours. Spaced by more than the one-hour minimum layover. */
const DEPARTURE_HOURS = [0, 8, 16];

/**
 * Flights a day needs before it counts as seeded.
 *
 * A day with a handful of flights is not a schedule: it is the wreckage of an
 * earlier run that failed halfway, and leaving it in place would make searches
 * for that date return almost nothing forever. Such a day is regenerated.
 */
const MIN_FLIGHTS_PER_DAY = 500;

/** The agency FlyNext authenticates as. Its API key is the sha-256 of this name. */
const AGENCY_NAME = process.env.AFS_LOCAL_AGENCY ?? "flynext-local";

/* -------------------------------------------------------------------------- */
/* Deterministic helpers                                                      */
/* -------------------------------------------------------------------------- */

/** FNV-1a, 32-bit: stable across processes, unlike `Math.random()`. */
function hash32(value) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** A seeded 32-bit xorshift generator. */
function seedRandom(seed) {
	let state = hash32(seed) || 0x9e3779b9;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 0x1_0000_0000;
	};
}

function intBetween(random, min, max) {
	return min + Math.floor(random() * (max - min + 1));
}

/** A UUID-shaped id, built from the same generator so it stays deterministic. */
function uuidFrom(random) {
	const hex = (length) =>
		Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");
	return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Block time in minutes, by the same domestic/international rule upstream uses. */
function blockMinutes(random, from, to) {
	const domestic = from.country === to.country;
	const raw = domestic ? intBetween(random, 60, 180) : intBetween(random, 300, 900);
	return Math.ceil(raw / 5) * 5;
}

/** Price in USD, distance-ish: longer flights cost more. */
function priceFor(random, minutes) {
	return Math.round((45 + minutes * 0.72) * (0.82 + random() * 0.46) * 100) / 100;
}

/** `YYYY-MM-DD` in UTC, matching how AFS parses a bare date. */
function isoDay(date) {
	return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

/** Insert the upstream airports and airlines, skipping what already exists. */
async function seedReferenceData() {
	for (const airport of airports) {
		await prisma.airport.upsert({
			where: { code: airport.code },
			create: {
				code: airport.code,
				name: airport.name,
				city: airport.city,
				country: airport.country,
			},
			update: {},
		});
	}
	console.log(`[seed] airports ready (${airports.length} in the dataset)`);

	let linked = 0;
	for (const airline of airlines) {
		const base = await prisma.airport.findUnique({
			where: { code: airline.baseCode },
		});
		if (base === null) {
			console.warn(`[seed] skipping ${airline.code}: base ${airline.baseCode} unknown`);
			continue;
		}
		await prisma.airline.upsert({
			where: { code: airline.code },
			create: {
				name: airline.name,
				code: airline.code,
				country: airline.country,
				baseId: base.id,
			},
			update: {},
		});
		linked += 1;
	}
	console.log(`[seed] airlines ready (${linked} linked to a base airport)`);
}

/**
 * Create the agency FlyNext authenticates as.
 *
 * The API key is the sha-256 of the agency name, which is how the upstream
 * `import_agencies.js` mints keys, so `.env.example` can document a key that is
 * reproducible rather than a value somebody has to copy out of a database.
 */
async function seedAgency() {
	const apiKey = createHash("sha256").update(AGENCY_NAME).digest("hex");
	await prisma.agency.upsert({
		where: { name: AGENCY_NAME },
		create: { name: AGENCY_NAME, apiKey, isActive: true },
		update: { apiKey, isActive: true },
	});
	console.log(`[seed] agency "${AGENCY_NAME}" ready`);
	console.log(`[seed] AFS_API_KEY=${apiKey}`);
}

/** How many flights each day in the window currently has. */
async function flightsPerDay(from, to) {
	const rows = await prisma.$queryRaw`
		SELECT DATE("departureTime") AS day, COUNT(*)::int AS total
		FROM "flights"
		WHERE "departureTime" >= ${from} AND "departureTime" < ${to}
		GROUP BY DATE("departureTime")
	`;
	const counts = new Map();
	for (const row of rows) {
		counts.set(isoDay(new Date(row.day)), Number(row.total));
	}
	return counts;
}

/**
 * Generate one day of flights for every airline's base airport.
 *
 * The day is cleared first and rewritten inside one transaction, so a run that
 * fails partway leaves the previous schedule intact rather than a half-populated
 * date — and a day that was left short by an earlier crash is repaired when this
 * runs again.
 */
async function seedDay(day, allAirports) {
	const dayStart = new Date(`${day}T00:00:00.000Z`);
	const dayEnd = new Date(dayStart.getTime() + 86_400_000);

	const rows = [];
	for (const airline of await prisma.airline.findMany({ include: { base: true } })) {
		const random = seedRandom(`${airline.code}@${day}`);
		const others = allAirports.filter((airport) => airport.id !== airline.baseId);
		const count = Math.max(1, Math.floor(others.length * DESTINATION_SHARE));

		// A stable subset per airline and day: the same airline serves the same
		// destinations all day, which is what makes a return leg findable.
		const destinations = [];
		for (let pick = 0; pick < count; pick += 1) {
			destinations.push(others[Math.floor(random() * others.length)]);
		}
		const unique = [...new Map(destinations.map((a) => [a.id, a])).values()];

		for (const destination of unique) {
			const minutes = blockMinutes(random, airline.base, destination);
			for (const hour of DEPARTURE_HOURS) {
				// A five-minute offset so the timetable does not look synthetic.
				const offset = intBetween(random, 0, 11) * 5;
				const departure = new Date(dayStart.getTime() + hour * 3_600_000 + offset * 60_000);
				const arrival = new Date(departure.getTime() + minutes * 60_000);
				rows.push({
					id: uuidFrom(random),
					flightNumber: `${airline.code}${intBetween(random, 100, 999)}`,
					departureTime: departure,
					arrivalTime: arrival,
					duration: minutes,
					price: priceFor(random, minutes),
					currency: "USD",
					availableSeats: intBetween(random, 12, 240),
					status: FlightStatus.SCHEDULED,
					airlineId: airline.id,
					originId: airline.baseId,
					destinationId: destination.id,
				});
			}
		}
	}

	await prisma.$transaction(async (tx) => {
		await tx.flight.deleteMany({
			where: { departureTime: { gte: dayStart, lt: dayEnd } },
		});
		// Chunked so one statement cannot grow past the driver's parameter limit.
		for (let index = 0; index < rows.length; index += 1_000) {
			await tx.flight.createMany({ data: rows.slice(index, index + 1_000) });
		}
	});

	return rows.length;
}

/**
 * Make sure every day in the window has a full schedule.
 *
 * Days are filled oldest first so that a first run covers the days a user is
 * most likely to search — tomorrow before next week.
 */
async function seedSchedule() {
	const allAirports = await prisma.airport.findMany({
		select: { id: true, code: true, city: true, country: true },
	});
	if (allAirports.length === 0) {
		throw new Error("no airports: the reference data step did not run");
	}

	const today = new Date(`${isoDay(new Date())}T00:00:00.000Z`);
	const horizon = new Date(today.getTime() + WINDOW_DAYS * 86_400_000);
	const existing = await flightsPerDay(today, horizon);

	for (let day = 0; day < WINDOW_DAYS; day += 1) {
		const date = isoDay(new Date(today.getTime() + day * 86_400_000));
		if ((existing.get(date) ?? 0) >= MIN_FLIGHTS_PER_DAY) {
			continue;
		}
		const created = await seedDay(date, allAirports);
		console.log(`[seed] ${date}: ${created} flights`);
	}

	const total = await prisma.flight.count();
	console.log(`[seed] schedule ready (${total} flights, window ${isoDay(today)}..${isoDay(horizon)})`);
}

/* -------------------------------------------------------------------------- */

async function main() {
	await seedReferenceData();
	await seedAgency();
	await seedSchedule();
}

main()
	.catch((error) => {
		console.error("[seed] failed", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
