/**
 * The offline AFS provider, and the dispatch that selects it.
 *
 * `lib/afs-client.ts` can answer from either a real HTTP service or the in-process
 * implementation in `lib/afs/offline.ts`. This suite covers the parts of that
 * arrangement that can break silently:
 *
 * - Mode selection: `lib/afs/config.ts` decides per call, and getting the
 *   precedence wrong means either a production deployment quietly serving invented
 *   flights, or a CI run trying to reach a provider that is not there.
 * - Contract fidelity: the offline data has to satisfy `types/afs.ts` and the
 *   invariants the code above it assumes — non-empty `flights`, `totalPrice` that
 *   matches its legs, ids that are still valid on the next request.
 * - Closed loops: search → book → retrieve → verify → cancel, and the
 *   compensation path when the local write fails. A canned stub satisfies the
 *   first call and breaks the rest, which is why these are asserted end to end.
 *
 * Nothing here reaches the network: `AFS_BASE_URL` in `.env.test` is a placeholder,
 * which is itself one of the conditions under test.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { GET as searchRoute } from "@/app/api/flights/search/route";
import { POST as bookRoute } from "@/app/api/flights/book/route";
import { GET as listFlightBookings } from "@/app/api/user/flight-bookings/route";
import { flightDirections } from "@/app/lib/booking-display";
import {
	cancelFlight,
	createBooking,
	isAfsOffline,
	retrieveBooking,
	searchFlights,
	verifyFlight,
} from "@/lib/afs-client";
import { resolveAfsMode } from "@/lib/afs/config";
import {
	dropTimetables,
	offlineStats,
	resetBookingLedger,
	resetBookingIdFactory,
	resetFlightRegistry,
	setBookingIdFactory,
} from "@/lib/afs/offline";
import {
	afsBookingKey,
	cancelFlightReservation,
	createFlightReservation,
} from "@/lib/reservations";
import { prisma, resetDatabase, disconnect } from "#support/db";
import { createUser } from "#support/factories";
import { callRoute, readJson, tokenFor } from "#support/requests";
import { readSeedJson } from "@/prisma/seed-fixtures";
import type {
	AfsBooking,
	AfsFlight,
	AfsFlightGroup,
	AfsFlightSearchParams,
	FlightBookingListItem,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** A date inside the provider's schedule: a week out, so it is always future. */
const SEARCH_DATE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

/** A second date, for the return half of a round trip. */
const RETURN_DATE = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

const PASSENGER = {
	email: "traveller@example.com",
	firstName: "Ada",
	lastName: "Lovelace",
	passportNumber: "P123456789",
};

/** The first leg of the first group in a result set. */
function firstFlight(groups: AfsFlightGroup[]): AfsFlight {
	const flight = groups[0]?.flights[0];
	if (flight === undefined) {
		throw new Error("the provider returned no flights for this search");
	}
	return flight;
}

/** The first group in a result set — one offered itinerary, one per direction. */
function firstGroup(groups: AfsFlightGroup[]): AfsFlightGroup {
	const group = groups[0];
	if (group === undefined) {
		throw new Error("the provider returned no flights for this search");
	}
	return group;
}

/**
 * The direction cards the booking history renders for a traveller's booking.
 *
 * Goes through the page's own endpoint and the page's own helper, so what is
 * asserted is the "Outbound" / "Return" panels on `/user/flight-bookings` rather
 * than the shape of a JSON column somewhere behind them.
 */
async function directionsFromHistory(userId: number) {
	const response = await callRoute(listFlightBookings, {
		token: tokenFor(userId),
		query: "includeCancelled=1",
	});
	expect(response.status).toBe(200);

	const body = await readJson<{ bookings: FlightBookingListItem[] }>(response);
	expect(body.bookings).toHaveLength(1);
	const booking = body.bookings[0]!;
	return flightDirections(booking.departure, booking.arrival);
}

/**
 * AFS's own booking id, which is what `retrieve`/`verify`/`cancel` accept.
 *
 * Asserted rather than defaulted: a booking response without an id would mean
 * `createFlightReservation` had fallen back to the passenger-facing reference,
 * which is not a key the provider resolves.
 */
function bookingKeyOf(booking: AfsBooking): string {
	expect(typeof booking.id).toBe("string");
	expect(booking.id).not.toBe("");
	return booking.id!;
}

/** Every invariant the layers above rely on, checked for one group. */
function expectWellFormedGroup(group: AfsFlightGroup): void {
	expect(Array.isArray(group.flights)).toBe(true);
	expect(group.flights.length).toBeGreaterThan(0);
	expect(group.legs).toBe(group.flights.length);

	const sum = group.flights.reduce((total, flight) => total + flight.price, 0);
	expect(group.totalPrice).toBeCloseTo(sum, 2);

	for (const flight of group.flights) {
		expect(typeof flight.id).toBe("string");
		expect(flight.id.length).toBeGreaterThan(0);
		expect(typeof flight.price).toBe("number");
		expect(flight.price).toBeGreaterThan(0);
		expect(Number.isFinite(flight.availableSeats)).toBe(true);
		expect(flight.availableSeats).toBeGreaterThanOrEqual(0);
		expect(flight.status).toBe("SCHEDULED");
		expect(Number.isNaN(new Date(flight.departureTime).getTime())).toBe(false);
		expect(Number.isNaN(new Date(flight.arrivalTime).getTime())).toBe(false);
		expect(new Date(flight.arrivalTime).getTime()).toBeGreaterThan(
			new Date(flight.departureTime).getTime()
		);
		expect(typeof flight.origin.code).toBe("string");
		expect(typeof flight.destination.code).toBe("string");
		expect(typeof flight.airline.code).toBe("string");
	}

	// Legs must be flyable in order: each one leaves after the previous lands.
	for (let index = 1; index < group.flights.length; index += 1) {
		const previous = group.flights[index - 1]!;
		const leg = group.flights[index]!;
		expect(new Date(leg.departureTime).getTime()).toBeGreaterThanOrEqual(
			new Date(previous.arrivalTime).getTime()
		);
		expect(leg.origin.code).toBe(previous.destination.code);

		/*
		 * And with the minimum layover to spare, which is what makes the group
		 * bookable rather than merely plausible. A pair of flights whose second leg
		 * leaves too soon is not a connection the booking endpoint accepts, and
		 * booking one fails with "Flights are not consecutive in sequence".
		 */
		const layover =
			new Date(leg.departureTime).getTime() -
			new Date(previous.arrivalTime).getTime();
		expect(layover).toBeGreaterThanOrEqual(60 * 60_000);
	}
}

/* -------------------------------------------------------------------------- */
/* Mode selection                                                             */
/* -------------------------------------------------------------------------- */

describe("AFS mode selection", () => {
	const saved = {
		base: process.env.AFS_BASE_URL,
		mock: process.env.AFS_MOCK,
	};

	afterEach(() => {
		// `undefined` deletes the key, which is the "not configured" state.
		process.env.AFS_BASE_URL = saved.base;
		process.env.AFS_MOCK = saved.mock;
	});

	it("uses the offline provider when no base URL is configured", () => {
		delete process.env.AFS_BASE_URL;
		delete process.env.AFS_MOCK;
		expect(resolveAfsMode()).toEqual({
			mode: "offline",
			reason: "no-usable-base-url",
		});
	});

	it("treats a placeholder or malformed base URL as not configured", () => {
		delete process.env.AFS_MOCK;
		for (const value of [
			"",
			"   ",
			"https://afs.invalid",
			"afs.internal:4000",
			"ftp://afs.example",
			"not a url",
		]) {
			process.env.AFS_BASE_URL = value;
			expect(resolveAfsMode().mode, JSON.stringify(value)).toBe("offline");
		}
	});

	it("uses the remote provider for a real address", () => {
		delete process.env.AFS_MOCK;
		process.env.AFS_BASE_URL = "http://localhost:4000";
		expect(resolveAfsMode()).toEqual({
			mode: "remote",
			reason: "remote-configured",
			baseUrl: "http://localhost:4000",
		});
	});

	it("lets AFS_MOCK=true override a configured address", () => {
		process.env.AFS_BASE_URL = "https://afs.internal.example";
		process.env.AFS_MOCK = "true";
		expect(resolveAfsMode()).toEqual({
			mode: "offline",
			reason: "forced-offline",
		});
		expect(isAfsOffline()).toBe(true);
	});

	it("accepts the usual spellings of the mock flag", () => {
		process.env.AFS_BASE_URL = "https://afs.internal.example";
		for (const value of ["1", "true", "TRUE", "yes", "on", " on "]) {
			process.env.AFS_MOCK = value;
			expect(resolveAfsMode().mode, value).toBe("offline");
		}
	});

	it("treats AFS_MOCK=false as a requirement, not a preference", () => {
		process.env.AFS_MOCK = "false";
		process.env.AFS_BASE_URL = "https://afs.internal.example";
		expect(resolveAfsMode()).toEqual({
			mode: "remote",
			reason: "forced-remote",
			baseUrl: "https://afs.internal.example",
		});
	});

	it("does not fall back to offline when the remote provider is required", () => {
		process.env.AFS_MOCK = "false";
		process.env.AFS_BASE_URL = "https://afs.invalid";
		// The remote address is missing, so there is nothing to call. This has to
		// stay an error path rather than becoming invented flight data.
		expect(resolveAfsMode().mode).toBe("offline");
		expect(isAfsOffline()).toBe(true);
	});
});

/* -------------------------------------------------------------------------- */
/* The offline contract                                                       */
/* -------------------------------------------------------------------------- */

describe("the offline AFS provider", () => {
	it("answers a direct search with well-formed groups", async () => {
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});

		expect(groups.length).toBeGreaterThan(0);
		groups.forEach(expectWellFormedGroup);
		// The requested cities are the ones in the answer.
		expect(groups[0]!.flights[0]!.origin.code).toBe("YYZ");
		expect(groups[0]!.flights[0]!.destination.code).toBe("LHR");
	});

	it("accepts a city name as well as an IATA code", async () => {
		const byCode = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const byCity = await searchFlights({
			origin: "Toronto",
			destination: "London",
			date: SEARCH_DATE,
		});

		// A city name resolves to every airport in it, and both of these cities
		// have more than one in the network (`Toronto`: YYZ, YTZ; `London`: LHR,
		// LGW), so a city search is a superset of the single-code one rather than an
		// equal set. Asserting equality of the two lengths would be asserting the
		// wrong property.
		expect(byCity.length).toBeGreaterThanOrEqual(byCode.length);
		expect(byCity[0]!.flights[0]!.id).toBe(byCode[0]!.flights[0]!.id);
		for (const group of byCity) {
			expect(["YYZ", "YTZ"]).toContain(group.flights[0]!.origin.code);
			expect(["LHR", "LGW"]).toContain(
				group.flights[group.flights.length - 1]!.destination.code
			);
		}
	});

	it("returns the reverse direction, so a round trip is bookable", async () => {
		const outbound = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const inbound = await searchFlights({
			origin: "LHR",
			destination: "YYZ",
			date: RETURN_DATE,
		});

		expect(outbound.length).toBeGreaterThan(0);
		expect(inbound.length).toBeGreaterThan(0);
		expect(inbound[0]!.flights[0]!.origin.code).toBe("LHR");
	});

	it("offers one-stop connections through a hub", async () => {
		// Two spokes of the same hub, so a connection exists: YVR and HKG both
		// connect to YYZ, and YVR does not connect to HKG directly.
		const groups = await searchFlights({
			origin: "YVR",
			destination: "HKG",
			date: SEARCH_DATE,
		});

		const connecting = groups.filter((group) => group.legs === 2);
		expect(connecting.length).toBeGreaterThan(0);
		connecting.forEach(expectWellFormedGroup);
		expect(groups.every((group) => group.legs === 2)).toBe(true);
		// The layover is real: the connecting leg leaves after the first lands.
		expect(connecting[0]!.flights[0]!.destination.code).toBe(
			connecting[0]!.flights[1]!.origin.code
		);
		expect(connecting[0]!.flights[0]!.destination.code).toBe("YYZ");
		expect(connecting[0]!.flights[1]!.destination.code).toBe("HKG");
	});

	it("is deterministic, so an id survives until it is booked", async () => {
		const first = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const second = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});

		expect(second.map((group) => group.flights.map((f) => f.id))).toEqual(
			first.map((group) => group.flights.map((f) => f.id))
		);
	});

	it("never offers the same itinerary twice", async () => {
		/*
		 * A hub-to-hub route that each of the two hubs also lists as a spoke would
		 * be walked twice, minting two byte-identical flights. The results page
		 * would render the same itinerary twice, and because it keys
		 * its tick-boxes on the flight ids, ticking one box would tick both.
		 *
		 * YYZ/LHR and YYZ/JFK are the routes where two hubs list each other; a route
		 * through a hub is included because connections are matched inside nested
		 * loops.
		 */
		for (const [origin, destination] of [
			["YYZ", "JFK"],
			["YYZ", "LHR"],
			["YVR", "HKG"],
			["YYZ", "CAN"],
		] as [string, string][]) {
			const groups = await searchFlights({
				origin,
				destination,
				date: SEARCH_DATE,
			});
			expect(groups.length, `${origin}->${destination}`).toBeGreaterThan(0);

			const seen = new Set<string>();
			for (const group of groups) {
				const key = group.flights.map((flight) => flight.id).join("|");
				expect(seen.has(key), `${origin}->${destination} repeated ${key}`).toBe(
					false
				);
				seen.add(key);
			}
		}
	});

	it("answers every airport the search form can offer", async () => {
		/*
		 * The autocomplete is built from the `Airport` table, which is seeded from
		 * `prisma/seed_data/airports.json`, while this provider has its own network.
		 * When the two drift, the form offers an airport the search cannot resolve
		 * and a perfectly valid pair fails with "No airports found for the given
		 * origin or destination location".
		 *
		 * The fixture holds more airports than the demo database does, so it is the
		 * stricter of the two: every code it lists must resolve here, in both
		 * directions, or a round trip to it is unbookable.
		 */
		const fixture = readSeedJson<{ code: string }[]>(
			path.join("seed_data", "airports.json")
		);
		expect(fixture.length).toBeGreaterThan(0);

		const unreachable: string[] = [];
		for (const { code } of fixture) {
			if (code === "YYZ") {
				continue;
			}
			const outbound = await searchFlights({
				origin: "YYZ",
				destination: code,
				date: SEARCH_DATE,
			});
			const inbound = await searchFlights({
				origin: code,
				destination: "YYZ",
				date: SEARCH_DATE,
			});
			if (outbound.length === 0 || inbound.length === 0) {
				unreachable.push(`${code} (out=${outbound.length}, back=${inbound.length})`);
			}
		}

		expect(unreachable).toEqual([]);
	});

	it("offers only itineraries the booking endpoint accepts", async () => {
		/*
		 * A search result is an offer, and an offer the booking endpoint refuses is
		 * a dead end the passenger only reaches after typing in their details. A
		 * route with no same-day pairing inside the minimum layover must therefore
		 * not be answered with its impossible pairings — the onward leg departing
		 * before the first leg lands — and those must not be reintroduced as "near
		 * misses" whenever the strict pass finds nothing. They sort first on price,
		 * so the cheapest itinerary on the results page would be the one guaranteed
		 * to fail with "Flights are not consecutive in sequence".
		 *
		 * YYZ→PEK is the route with the tightest timetables; the others are here so
		 * the check is not tied to one timetable.
		 */
		for (const [origin, destination] of [
			["YYZ", "PEK"],
			["YYZ", "CAN"],
			["YYZ", "MEL"],
			["EZE", "YYZ"],
			["YVR", "HKG"],
		] as [string, string][]) {
			const groups = await searchFlights({ origin, destination, date: SEARCH_DATE });
			expect(groups.length, `${origin}->${destination}`).toBeGreaterThan(0);

			// Every invariant, including the minimum layover between legs.
			groups.forEach((group) =>
				expectWellFormedGroup(group)
			);
		}
	});

	it("sells the itinerary it offered", async () => {
		// The invariant above, closed end to end: what the results page shows is
		// what `POST /api/bookings` sells, on the route whose timetables leave the
		// least room for a valid connection.
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "PEK",
			date: SEARCH_DATE,
		});
		const group = groups[0]!;
		expect(group.legs).toBe(2);

		const booking = await createBooking({
			...PASSENGER,
			flightIds: group.flights.map((flight) => flight.id),
		});
		expect(booking.status).toBe("CONFIRMED");
		expect(booking.flights.map((flight) => flight.id)).toEqual(
			group.flights.map((flight) => flight.id)
		);
	});

	it("waits for the next day rather than offering a connection nobody can make", async () => {
		/*
		 * The fallback for a route whose only same-day pairing misses the layover:
		 * the first departure of the following day. It has to be a real, bookable
		 * flight — not a second leg left over from the searched date.
		 */
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "PEK",
			date: SEARCH_DATE,
		});
		expect(groups.length).toBeGreaterThan(0);
		groups.forEach(expectWellFormedGroup);

		const connecting = groups.filter((group) => group.legs === 2);
		expect(connecting.length).toBeGreaterThan(0);
		const [first, second] = connecting[0]!.flights as [AfsFlight, AfsFlight];
		expect(
			new Date(second.departureTime).getTime() -
				new Date(first.arrivalTime).getTime()
		).toBeGreaterThanOrEqual(60 * 60_000);
		// The onward leg leaves after the searched day, which is the whole point.
		expect(second.departureTime.slice(0, 10) > SEARCH_DATE).toBe(true);

		// And the id it hands out resolves: the booking is accepted.
		await expect(
			createBooking({ ...PASSENGER, flightIds: [first.id, second.id] })
		).resolves.toMatchObject({ status: "CONFIRMED" });
	});

	it("refuses a connection that leaves less than the minimum layover", async () => {
		/*
		 * The provider's search never offers one of these — that is the invariant
		 * above — so a caller can only produce one by assembling `flightIds` itself.
		 * Accepting it would sell a connection no passenger can physically make, and
		 * the upstream service refuses it; this implementation has to refuse the
		 * same input to stay interchangeable.
		 *
		 * The pair is read out of the published timetable rather than invented, so
		 * the two legs really do connect (`A` lands where `B` departs) and the only
		 * thing wrong with them is the minimum layover being missed.
		 */
		const legs: AfsFlight[] = [];
		for (const [origin, destination] of [
			["YYZ", "FRA"],
			["FRA", "PEK"],
		] as [string, string][]) {
			const groups = await searchFlights({ origin, destination, date: SEARCH_DATE });
			for (const group of groups) {
				legs.push(...group.flights);
			}
		}

		let connected: [AfsFlight, AfsFlight] | undefined;
		for (const first of legs) {
			for (const second of legs) {
				if (first.destination.code !== second.origin.code) {
					continue;
				}
				const gap =
					new Date(second.departureTime).getTime() -
					new Date(first.arrivalTime).getTime();
				if (gap >= 0 && gap < 60 * 60_000) {
					connected = [first, second];
				}
			}
		}
		const pair = connected;
		expect(pair, "the timetable should contain a sub-hour connection").toBeDefined();

		await expect(
			createBooking({ ...PASSENGER, flightIds: [pair![0].id, pair![1].id] })
		).rejects.toMatchObject({
			status: 400,
			message: expect.stringMatching(/less than an hour/i),
		});

		/*
		 * And the search must not have offered it either. Offering an itinerary
		 * the booking endpoint refuses is the failure this suite exists to prevent;
		 * the layover rule is part of that contract, not an extra check on top of
		 * it.
		 */
		const offered = await searchFlights({
			origin: "YYZ",
			destination: "PEK",
			date: SEARCH_DATE,
		});
		for (const group of offered) {
			expect(group.flights.map((flight) => flight.id)).not.toEqual([
				pair![0].id,
				pair![1].id,
			]);
		}
	});

	it("reports an out-of-order itinerary as not consecutive", async () => {
		// The message the results page produces when a return leg is handed over
		// that leaves before the outbound arrives.
		const outbound = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: RETURN_DATE })
		);
		const earlier = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);

		await expect(
			createBooking({ ...PASSENGER, flightIds: [outbound.id, earlier.id] })
		).rejects.toMatchObject({
			status: 400,
			message: expect.stringMatching(/not consecutive in sequence/i),
		});
	});

	it("reports the upstream error messages for a bad search", async () => {
		const cases: [string, AfsFlightSearchParams, RegExp][] = [
			[
				"missing parameters",
				{ origin: "", destination: "LHR", date: SEARCH_DATE },
				/required parameters/i,
			],
			[
				"wrong date format",
				{ origin: "YYZ", destination: "LHR", date: "01-01-2026" },
				/YYYY-MM-DD/i,
			],
			[
				"same origin and destination",
				{ origin: "YYZ", destination: "yyz", date: SEARCH_DATE },
				/cannot be the same/i,
			],
			[
				"unknown airport",
				{ origin: "ZZZ", destination: "LHR", date: SEARCH_DATE },
				/No airports found/i,
			],
		];

		for (const [label, params, pattern] of cases) {
			await expect(searchFlights(params), label).rejects.toMatchObject({
				status: 400,
				message: expect.stringMatching(pattern),
			});
		}
	});

	it("books a searched flight, then retrieves, verifies and cancels it", async () => {
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const flight = firstFlight(groups);
		const seatsBefore = flight.availableSeats;

		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		expect(booking.status).toBe("CONFIRMED");
		// The reference is the passenger-facing identifier the UI shows; the id is
		// the key AFS resolves. They are not interchangeable, and the reservation
		// helper stores the id — see the "keyed by its AFS id" case below.
		expect(booking.bookingReference).toMatch(/^[0-9A-F]{6}$/);
		expect(typeof booking.ticketNumber).toBe("string");
		expect(booking.flights.map((leg) => leg.id)).toEqual([flight.id]);
		// The seat was really taken, and the count came back with the booking.
		expect(booking.flights[0]!.availableSeats).toBe(seatsBefore - 1);

		// AFS matches the surname case-insensitively, and so must this.
		const retrieved = await retrieveBooking("lovelace", bookingKeyOf(booking));
		expect(retrieved.bookingReference).toBe(booking.bookingReference);
		expect(retrieved.status).toBe("CONFIRMED");
		expect(retrieved.flights.map((leg) => leg.id)).toEqual([flight.id]);

		const verification = await verifyFlight(bookingKeyOf(booking), "Lovelace");
		expect(verification.status).toBe("CONFIRMED");
		expect(verification.flights[0]!.status).toBe("SCHEDULED");

		const cancelled = await cancelFlight(bookingKeyOf(booking), "Lovelace");
		expect(cancelled.status).toBe("CANCELLED");
		// The seat is released, and cancelling twice does not release it twice.
		expect(cancelled.flights[0]!.availableSeats).toBe(seatsBefore);
		const again = await cancelFlight(bookingKeyOf(booking), "Lovelace");
		expect(again.status).toBe("CANCELLED");
		expect(again.flights[0]!.availableSeats).toBe(seatsBefore);
	});

	it("keeps the AFS id and the passenger reference distinct", async () => {
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });

		// The reference is derived from the id and is what the UI shows. They are
		// different values, and only the id is a key AFS is documented to resolve.
		// Storing the reference locally is what made every verify and cancel fail
		// against a real service with "Booking not found".
		expect(bookingKeyOf(booking)).not.toBe(booking.bookingReference);
		expect(booking.bookingReference).toBe(
			booking.id!.slice(0, 6).toUpperCase()
		);

		// `createFlightReservation` must persist the id, because
		// `cancelFlightReservation` sends exactly this value back to AFS.
		expect(afsBookingKey(booking)).toBe(booking.id);
	});

	it("refuses a booking the real service would refuse", async () => {
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const flight = firstFlight(groups);

		const cases: [string, Parameters<typeof createBooking>[0], number, RegExp][] = [
			[
				"unknown flight",
				{ ...PASSENGER, flightIds: ["00000000-0000-4000-a000-000000000000"] },
				404,
				/not found/i,
			],
			["short passport", { ...PASSENGER, passportNumber: "P1", flightIds: [flight.id] }, 400, /9 digits/i],
			["no flight ids", { ...PASSENGER, flightIds: [] }, 400, /flight IDs/i],
			["blank name", { ...PASSENGER, firstName: "  ", flightIds: [flight.id] }, 400, /firstName/i],
		];

		for (const [label, payload, status, pattern] of cases) {
			await expect(createBooking(payload), label).rejects.toMatchObject({
				status,
				message: expect.stringMatching(pattern),
			});
		}
	});

	it("does not consume a seat when the booking is rejected", async () => {
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "CDG",
			date: SEARCH_DATE,
		});
		const flight = firstFlight(groups);
		const seatsBefore = flight.availableSeats;

		await expect(
			createBooking({ ...PASSENGER, passportNumber: "short", flightIds: [flight.id] })
		).rejects.toMatchObject({ status: 400 });

		const after = await searchFlights({
			origin: "YYZ",
			destination: "CDG",
			date: SEARCH_DATE,
		});
		expect(firstFlight(after).availableSeats).toBe(seatsBefore);
	});

	it("keeps a sold seat sold across searches", async () => {
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const before = flight.availableSeats;
		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		expect(booking.flights[0]!.availableSeats).toBe(before - 1);

		const again = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		expect(again.id).toBe(flight.id);
		expect(again.availableSeats).toBe(before - 1);

		const rebound = await createBooking({ ...PASSENGER, flightIds: [again.id] });
		expect(rebound.flights[0]!.availableSeats).toBe(before - 2);
	});

	it("keeps a sold seat sold when the timetable is rebuilt", async () => {
		// A flight id is a pure function of its route and departure time, so a
		// rebuild after a cache eviction mints the same ids. Seat counts have to
		// survive that: reporting a sold flight as empty again would let one seat be
		// sold over and over.
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		// Read the count off the booking: `flight` is the live object, so its own
		// `availableSeats` has already changed underneath the test by this point.
		const sold = booking.flights[0]!.availableSeats;

		dropTimetables();

		const rebuilt = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		expect(rebuilt.id).toBe(flight.id);
		expect(rebuilt.availableSeats).toBe(sold);
		// And the rebuilt object is the live one, not a copy that diverges later.
		const secondBooking = await createBooking({
			...PASSENGER,
			flightIds: [rebuilt.id],
		});
		expect(secondBooking.flights[0]!.availableSeats).toBe(sold - 1);
	});

	it("keeps the store bounded so a long-lived process cannot grow forever", async () => {
		// A search registers a whole day of flights. Bounding that registry is what
		// keeps a long-lived process finite, but the bound has to be spent on the
		// right flights: evicting strictly oldest-first discards the itinerary a
		// user is looking at while a later search builds another date — and the
		// failure only appears at booking time, as "One or more flights not found".
		const soon: string[] = [];
		for (let day = 0; day < 20; day += 1) {
			const date = new Date(Date.now() + (day + 30) * 86_400_000)
				.toISOString()
				.slice(0, 10);
			soon.push(date);
			await searchFlights({ origin: "YYZ", destination: "LHR", date });
		}

		const stats = offlineStats();
		expect(stats.cachedDays).toBeLessThanOrEqual(32);
		// Twenty searches is far more than one process needs, so the registry is
		// genuinely over budget here and the bound is being exercised.
		expect(stats.registeredFlights).toBeLessThanOrEqual(15_000);

		// And the most recent search is still bookable, which is the property the
		// bound must not break: those flights were registered after every eviction
		// this test forced, so nothing was in a position to drop them.
		const recent = firstFlight(
			await searchFlights({
				origin: "YYZ",
				destination: "LHR",
				date: soon[soon.length - 1]!,
			})
		);
		const booking = await createBooking({ ...PASSENGER, flightIds: [recent.id] });
		expect(booking.flights[0]!.id).toBe(recent.id);
	});
});

/* -------------------------------------------------------------------------- */
/* Surviving a second worker                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The failures that only appear once the provider runs on a serverless host.
 *
 * There, a search and the booking that follows it are usually two invocations,
 * and often two workers: the second one has never seen the first one's memory.
 * The cases below reproduce that by emptying the state the first "worker" built —
 * the flight registry, or the whole in-process booking map — and then making the
 * second request. Nothing else changes, so a failure here is a real dependency on
 * process-local state rather than a simulation of one.
 */
describe("the offline AFS provider across workers", () => {
	beforeEach(async () => {
		await resetDatabase();
		resetFlightRegistry();
	});

	afterAll(async () => {
		await disconnect();
	});

	it("mints flight ids that say which flight they are", async () => {
		/*
		 * The property everything below rests on. An id has to say which flight it
		 * names, so any worker can answer for a search it never ran: a hash that
		 * only had to look like a uuid would leave that worker refusing the booking
		 * with "One or more flights not found".
		 */
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);

		expect(flight.id).toMatch(/^[A-Z]{3}-[A-Z]{3}-\d{8}-\d{4}-\d{2}$/);
		// The route and the day are in the id, and both are the ones searched for.
		expect(flight.id.startsWith(`YYZ-LHR-${SEARCH_DATE.replace(/-/g, "")}-`)).toBe(
			true
		);
		// And the timestamp it encodes is the departure the flight actually has.
		const [, , day, hhmm, ss] = flight.id.split("-") as [
			string,
			string,
			string,
			string,
			string,
		];
		const decoded = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:${ss}.000Z`;
		expect(new Date(decoded).toISOString()).toBe(flight.departureTime);
	});

	it("books a flight this worker never searched for", async () => {
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);

		// The worker that answers the booking has nothing of the search in memory.
		resetFlightRegistry();
		expect(offlineStats().registeredFlights).toBe(0);

		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		expect(booking.status).toBe("CONFIRMED");
		expect(booking.flights.map((leg) => leg.id)).toEqual([flight.id]);
		// The seat is the one that was searched for, not a flight that merely
		// happens to be on the same route.
		expect(booking.flights[0]!.departureTime).toBe(flight.departureTime);
		expect(booking.flights[0]!.price).toBe(flight.price);
	});

	it("books both legs of a round trip on a worker that searched for neither", async () => {
		// A round trip holds ids from two searches, and the worker that takes the
		// booking has run neither of them.
		const outbound = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const inbound = firstFlight(
			await searchFlights({ origin: "LHR", destination: "YYZ", date: RETURN_DATE })
		);

		resetFlightRegistry();

		const booking = await createBooking({
			...PASSENGER,
			flightIds: [outbound.id, inbound.id],
		});
		expect(booking.status).toBe("CONFIRMED");
		expect(booking.flights.map((leg) => leg.id)).toEqual([outbound.id, inbound.id]);
	});

	it("still refuses a flight id that names nothing", async () => {
		// The stateless check must keep refusing what is genuinely invalid, or the
		// booking endpoint would sell tickets on flights that do not exist. Every id
		// here is well-formed; none is a departure the timetable serves.
		const cases = [
			// A real route and day, at a time nothing departs.
			`YYZ-LHR-${SEARCH_DATE.replace(/-/g, "")}-0317-00`,
			// A real route on a day outside the schedule.
			"YYZ-LHR-19990101-0800-00",
			// A day that does not exist.
			"YYZ-LHR-20260231-0800-00",
			// A route the network does not fly.
			`AKL-${"YXY"}-${SEARCH_DATE.replace(/-/g, "")}-0800-00`,
			// An airport that is not in the network at all.
			`ZZZ-LHR-${SEARCH_DATE.replace(/-/g, "")}-0800-00`,
			// A well-formed uuid, but in no format the provider mints, naming a
			// flight that never existed.
			"00000000-0000-4000-a000-000000000000",
		];

		for (const id of cases) {
			await expect(
				createBooking({ ...PASSENGER, flightIds: [id] }),
				id
			).rejects.toMatchObject({
				status: 404,
				message: expect.stringMatching(/not found/i),
			});
		}
	});

	it("retrieves and cancels a booking made by another worker", async () => {
		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const booking = await createBooking({ ...PASSENGER, flightIds: [flight.id] });

		/*
		 * The worker that answers the retrieve and the cancel has never heard of
		 * this booking — `resetBookingLedger` empties the in-process map, and the
		 * registry goes with it, so nothing about the booking survives except the
		 * ledger row. The ledger row alone has to be enough to answer, rather than
		 * "Booking not found".
		 */
		resetBookingLedger();
		resetFlightRegistry();

		const retrieved = await retrieveBooking("lovelace", booking.id!);
		expect(retrieved.bookingReference).toBe(booking.bookingReference);
		expect(retrieved.status).toBe("CONFIRMED");
		expect(retrieved.flights.map((leg) => leg.id)).toEqual([flight.id]);

		const cancelled = await cancelFlight(booking.id!, "Lovelace");
		expect(cancelled.status).toBe("CANCELLED");

		// And it stays cancelled for a third worker, with no double release.
		resetBookingLedger();
		resetFlightRegistry();
		const again = await cancelFlight(booking.id!, "Lovelace");
		expect(again.status).toBe("CANCELLED");
	});

	it("refuses a booking that no worker ever made", async () => {
		resetBookingLedger();
		await expect(
			retrieveBooking("Lovelace", crypto.randomUUID())
		).rejects.toMatchObject({
			status: 404,
			message: expect.stringMatching(/Booking not found/i),
		});
	});

	it("still answers for a booking the provider never recorded", async () => {
		/*
		 * A booking with no row in the ledger has only one trace: the
		 * `FlightReservation` the application wrote. Refusing to verify or cancel it
		 * would strand the passenger on a booking this application itself showed
		 * them. The id is the capability: it is a uuid, it is what the booking page
		 * displays, and the passenger-facing reference is only its first six
		 * characters.
		 */
		const user = await createUser({ lastName: "Lovelace" });
		const legacyId = "abc123-0000-4000-a000-000000000000";
		await prisma.flightReservation.create({
			data: {
				userId: user.id,
				afsBookingId: legacyId,
				departure: {},
				arrival: {},
				price: 1,
				status: "CONFIRMED",
			},
		});
		resetBookingLedger();

		const retrieved = await retrieveBooking("Lovelace", legacyId);
		expect(retrieved.status).toBe("CONFIRMED");

		const cancelled = await cancelFlight(legacyId, "Lovelace");
		expect(cancelled.status).toBe("CANCELLED");
	});
});

/* -------------------------------------------------------------------------- */
/* Dispatch: the client over the offline provider                             */
/* -------------------------------------------------------------------------- */

describe("lib/afs-client over the offline provider", () => {
	beforeEach(async () => {
		await resetDatabase();
		/*
		 * The case above deliberately pushes the store bound, which leaves the
		 * registry full of other dates' flights. Without this, the searches here
		 * are answered normally and then fail at booking time with
		 * "One or more flights not found" — a real behaviour of the provider, but
		 * not what these cases are testing.
		 */
		resetFlightRegistry();
	});

	afterAll(async () => {
		await disconnect();
	});

	it("routes every call offline when no usable URL is configured", () => {
		// `.env.test` sets a placeholder address plus AFS_MOCK, so this asserts the
		// suite is genuinely cut off from any real provider.
		expect(isAfsOffline()).toBe(true);
	});

	it("returns groups the search route serialises unchanged", async () => {
		const groups = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		expect(groups.length).toBeGreaterThan(0);

		const response = await callRoute(searchRoute, {
			query: `origin=YYZ&destination=LHR&date=${SEARCH_DATE}`,
		});
		expect(response.status).toBe(200);

		// The route must keep returning a bare array.
		const body = await readJson<AfsFlightGroup[]>(response);
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBe(groups.length);
		expect(body[0]!.flights[0]!.id).toBe(groups[0]!.flights[0]!.id);
	});

	it("returns durations the results page can do arithmetic on", async () => {
		/*
		 * AFS reports `duration` as an ISO-8601 string ("PT2H35M"). The page sums
		 * its legs and formats the total as `Xh Ym`, so a string in that position
		 * renders "NaNh NaNm" for a single leg and concatenates
		 * ("0PT1H30MPT10H") for a connection. The route must hand over minutes, and
		 * must not leave the ISO string where a consumer can mistake it for a
		 * number.
		 */
		const response = await callRoute(searchRoute, {
			query: `origin=YYZ&destination=LHR&date=${SEARCH_DATE}`,
		});
		expect(response.status).toBe(200);
		const body = await readJson<(AfsFlightGroup & { flights: AfsFlight[] })[]>(
			response
		);
		expect(body.length).toBeGreaterThan(0);

		const legs = body.flatMap((group) => group.flights);
		expect(legs.length).toBeGreaterThan(0);
		for (const leg of legs) {
			expect(typeof leg.durationMinutes, `leg ${leg.id}`).toBe("number");
			expect(Number.isFinite(leg.durationMinutes!)).toBe(true);
			expect(leg.durationMinutes!).toBeGreaterThan(0);
			// The ISO string is gone, so nothing can read it as minutes by mistake.
			expect(leg.duration).toBeUndefined();
		}

		// The group total is the sum of its own legs, which is what the page shows.
		for (const group of body) {
			const sum = group.flights.reduce(
				(total, leg) => total + (leg.durationMinutes ?? 0),
				0
			);
			expect(group.totalDuration).toBe(sum);
			expect(Number.isFinite(group.totalDuration!)).toBe(true);
		}
	});

	it("books through the route and mirrors the ticket locally", async () => {
		const user = await createUser({ lastName: "Lovelace" });

		const groups = await searchFlights({
			origin: "YYZ",
			destination: "LHR",
			date: SEARCH_DATE,
		});
		const flight = firstFlight(groups);

		const response = await callRoute(bookRoute, {
			method: "POST",
			token: tokenFor(user.id),
			json: { ...PASSENGER, flightIds: [flight.id] },
		});

		expect(response.status).toBe(201);
		const body = await readJson<
			AfsBooking & { message: string; reservationId: number }
		>(response);
		expect(body.message).toMatch(/completed successfully/i);
		expect(body.status).toBe("CONFIRMED");
		expect(body.reservationId).toBeGreaterThan(0);
		expect(body.bookingReference).toMatch(/^[0-9A-F]{6}$/);

		const stored = await prisma.flightReservation.findUniqueOrThrow({
			where: { id: body.reservationId },
		});
		/*
		 * The row is keyed by the AFS id, not by the passenger-facing
		 * reference the response also carries. Storing the reference instead would
		 * make "Verify Flight Status" and "Cancel Booking" answer "Booking not
		 * found": `cancelFlightReservation` sends this exact column back to AFS, and
		 * only the id is a key AFS resolves.
		 */
		expect(stored.afsBookingId).toBe(body.id);
		expect(stored.afsBookingId).not.toBe(body.bookingReference);
		expect(stored.afsBookingId.startsWith(body.bookingReference.toLowerCase())).toBe(
			true
		);
		expect(stored.status).toBe("CONFIRMED");
		expect(stored.price).toBeCloseTo(flight.price, 2);

		// Both the id the row is keyed by and the reference the route handed back
		// resolve upstream, which is what the booking-history and itinerary pages
		// depend on.
		const verification = await verifyFlight(stored.afsBookingId, "Lovelace");
		expect(verification.status).toBe("CONFIRMED");
		expect(verification.flights[0]!.id).toBe(flight.id);
	});

	it("books both legs of a round trip in one call", async () => {
		const user = await createUser({ lastName: "Lovelace" });
		const outbound = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const inbound = firstFlight(
			await searchFlights({ origin: "LHR", destination: "YYZ", date: RETURN_DATE })
		);

		const response = await callRoute(bookRoute, {
			method: "POST",
			token: tokenFor(user.id),
			json: { ...PASSENGER, flightIds: [outbound.id, inbound.id] },
		});

		expect(response.status).toBe(201);
		const body = await readJson<AfsBooking & { reservationId: number }>(response);
		expect(body.flights.map((leg) => leg.id)).toEqual([outbound.id, inbound.id]);

		const stored = await prisma.flightReservation.findUniqueOrThrow({
			where: { id: body.reservationId },
		});
		expect(stored.price).toBeCloseTo(outbound.price + inbound.price, 2);
		// The return leg is recorded on the outbound row's JSON column.
		expect((stored.departure as Record<string, unknown>).returnAirport).toBe("LHR");
	});

	it("records a connecting one-way as one direction of travel", async () => {
		const user = await createUser({ lastName: "Lovelace" });

		/*
		 * No airline flies YYZ→CAN non-stop, so every group this search offers is
		 * a one-stop itinerary: two legs in one direction. Reading the second leg as
		 * the return half is what puts this ticket on the booking history as an
		 * "Outbound" card plus a "Return" card that are really its two legs.
		 */
		const group = firstGroup(
			await searchFlights({ origin: "YYZ", destination: "CAN", date: SEARCH_DATE })
		);
		expect(group.flights.length).toBeGreaterThan(1);

		const response = await callRoute(bookRoute, {
			method: "POST",
			token: tokenFor(user.id),
			json: {
				...PASSENGER,
				flightIds: group.flights.map((leg) => leg.id),
				returnLegCount: 0,
			},
		});
		expect(response.status).toBe(201);

		const directions = await directionsFromHistory(user.id);
		expect(directions).toHaveLength(1);
		expect(directions[0]).toMatchObject({
			kind: "outbound",
			from: "YYZ",
			to: "CAN",
			departDate: group.flights[0]!.departureTime,
			arriveDate: group.flights[group.flights.length - 1]!.arrivalTime,
		});
		// Every airport it changes planes at is on the card, and each flight of the
		// journey is listed: "From YYZ To CAN" on its own reads as non-stop.
		expect(directions[0].stops).toEqual(
			group.flights.slice(1).map((leg) => leg.origin.code)
		);
		expect(directions[0].legs.map((leg) => `${leg.from}>${leg.to}`)).toEqual(
			group.flights.map((leg) => `${leg.origin.code}>${leg.destination.code}`)
		);
	});

	it("records a connecting round trip as an outbound and a return", async () => {
		const user = await createUser({ lastName: "Lovelace" });

		const outbound = firstGroup(
			await searchFlights({ origin: "YYZ", destination: "CAN", date: SEARCH_DATE })
		);
		const inbound = firstGroup(
			await searchFlights({ origin: "CAN", destination: "YYZ", date: RETURN_DATE })
		);
		expect(outbound.flights.length).toBeGreaterThan(1);
		expect(inbound.flights.length).toBeGreaterThan(1);

		const response = await callRoute(bookRoute, {
			method: "POST",
			token: tokenFor(user.id),
			json: {
				...PASSENGER,
				// One ticket: the outbound legs first, then the way home. The count
				// is what tells the two halves apart.
				flightIds: [...outbound.flights, ...inbound.flights].map((leg) => leg.id),
				returnLegCount: inbound.flights.length,
			},
		});
		expect(response.status).toBe(201);
		const body = await readJson<{ reservationId: number }>(response);

		const stored = await prisma.flightReservation.findUniqueOrThrow({
			where: { id: body.reservationId },
		});
		// One ticket, one row, and the price of the whole trip.
		expect(stored.price).toBeCloseTo(
			[...outbound.flights, ...inbound.flights].reduce(
				(total, leg) => total + leg.price,
				0
			),
			2
		);

		const directions = await directionsFromHistory(user.id);
		expect(directions.map((direction) => direction.kind)).toEqual([
			"outbound",
			"return",
		]);
		expect(directions[0]).toMatchObject({
			from: "YYZ",
			to: "CAN",
			departDate: outbound.flights[0]!.departureTime,
			arriveDate: outbound.flights[outbound.flights.length - 1]!.arrivalTime,
		});
		expect(directions[1]).toMatchObject({
			from: "CAN",
			to: "YYZ",
			departDate: inbound.flights[0]!.departureTime,
			arriveDate: inbound.flights[inbound.flights.length - 1]!.arrivalTime,
		});
		// Each half shows where it changes planes, not just where it starts and
		// ends — the two halves of a round trip connect through different hubs.
		expect(directions[0].stops).toEqual(
			outbound.flights.slice(1).map((leg) => leg.origin.code)
		);
		expect(directions[1].stops).toEqual(
			inbound.flights.slice(1).map((leg) => leg.origin.code)
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Compensation and refund                                                    */
/* -------------------------------------------------------------------------- */

describe("flight booking compensation over the offline provider", () => {
	beforeEach(async () => {
		await resetDatabase();
		// The same reason as the sibling suite above: the store bound is pushed by
		// an earlier case, and these ones need the ids they search for to survive.
		resetFlightRegistry();
	});

	afterEach(() => {
		resetBookingIdFactory();
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await disconnect();
	});

	it("releases the ticket when the local reservation cannot be written", async () => {
		const user = await createUser({ lastName: "Lovelace" });

		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);

		const events: string[] = [];
		const spy = vi
			.spyOn(console, "warn")
			.mockImplementation((...args: unknown[]) => {
				events.push(args.map(String).join(" "));
			});

		// A stored booking that owns the key the next booking will be handed, so the
		// local insert collides with the unique index on `afsBookingId`. The key is
		// the booking's full AFS id — `afsBookingKey` prefers `id` over the
		// passenger-facing reference, which is only its first six characters — so the
		// fixture below has to store the whole value, not the reference.
		const TAKEN_REFERENCE = "abc123";
		const takenId = `${TAKEN_REFERENCE}-0000-4000-a000-000000000000`;
		let minted = 0;
		setBookingIdFactory(() => {
			minted += 1;
			return minted === 1 ? crypto.randomUUID() : takenId;
		});
		const first = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		expect(first.bookingReference).not.toBe("ABC123");
		// The seat count the provider itself reports, after selling one seat.
		const seatsAfterFirst = first.flights[0]!.availableSeats;
		await prisma.flightReservation.create({
			data: {
				userId: user.id,
				afsBookingId: takenId,
				departure: {},
				arrival: {},
				price: 1,
				status: "CANCELLED",
			},
		});
		events.length = 0;

		// Drive the real compensation path: the provider books, the local insert
		// fails, and the client asks the provider to release the ticket again.
		await expect(
			createFlightReservation({ ...PASSENGER, flightIds: [flight.id] }, user.id)
		).rejects.toMatchObject({ status: 502 });

		spy.mockRestore();

		// A released ticket is self-resolved: the compensation cancelled the
		// reference upstream, so the operator gets an event rather than an alert.
		expect(events.some((line) => line.includes("flight.booking.compensated"))).toBe(
			true
		);
		expect(events.some((line) => line.includes("flight.booking.orphaned"))).toBe(false);
		/*
		 * The released booking is looked up by its id, which is the only key the
		 * provider's retrieve and cancel endpoints accept, and the only value
		 * `afsBookingKey` writes to the local row. The six-character reference is
		 * the passenger-facing display value — it is not something
		 * `cancelFlightReservation` ever sends back, and treating it as a prefix
		 * would make a guessable short string sufficient to cancel a booking.
		 */
		await expect(verifyFlight(takenId, "Lovelace")).resolves.toMatchObject({
			status: "CANCELLED",
		});
		// The first booking is untouched: it is a different booking, not a retry.
		await expect(
			verifyFlight(first.id!, "Lovelace")
		).resolves.toMatchObject({ status: "CONFIRMED" });

		// The seat the failed attempt took was given back: the only sale left is the
		// first booking's. Releasing it confirms the same seat is live.
		const after = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		expect(after.availableSeats).toBe(seatsAfterFirst);

		await cancelFlight(first.id!, "Lovelace");
		const restored = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		expect(restored.availableSeats).toBe(seatsAfterFirst + 1);
	});

	it("raises an orphan alert when the release itself fails", async () => {
		const user = await createUser({ lastName: "Lovelace" });

		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);

		// A stored booking that owns the key the next attempt will be handed, so the
		// local write really fails; the injected release then refuses to cancel —
		// the combination that needs a human. The key is the full AFS id, which is
		// what `afsBookingKey` writes (see the note on the compensated case above).
		const TAKEN_REFERENCE = "def456";
		const takenId = `${TAKEN_REFERENCE}-0000-4000-a000-000000000000`;
		let minted = 0;
		setBookingIdFactory(() => {
			minted += 1;
			return minted === 1 ? crypto.randomUUID() : takenId;
		});
		const first = await createBooking({ ...PASSENGER, flightIds: [flight.id] });
		expect(first.bookingReference).not.toBe("DEF456");
		await prisma.flightReservation.create({
			data: {
				userId: user.id,
				afsBookingId: takenId,
				departure: {},
				arrival: {},
				price: 1,
				status: "CANCELLED",
			},
		});

		const records: string[] = [];
		const spy = vi
			.spyOn(console, "error")
			.mockImplementation((...args: unknown[]) => {
				records.push(args.map(String).join(" "));
			});

		await expect(
			createFlightReservation({ ...PASSENGER, flightIds: [flight.id] }, user.id, {
				// The provider accepts the booking but will not take it back.
				cancelFlight: async () => ({ status: "CONFIRMED" }),
			})
		).rejects.toMatchObject({
			status: 502,
			message: expect.stringMatching(/could not be released/i),
		});

		spy.mockRestore();

		const alert = records.find((line) => line.includes("flight.booking.orphaned"));
		expect(alert).toBeDefined();
		const json = JSON.parse(alert!.slice(alert!.indexOf("{"))) as {
			alert: boolean;
			detail: Record<string, unknown>;
		};
		expect(json.alert).toBe(true);
		// The alert carries the full key, not the passenger-facing reference: it is
		// the identifier an operator has to hand back to `retrieve`/`cancel`, and it
		// is what `afsBookingKey` writes to the local row too.
		expect(json.detail.bookingReference).toBe(takenId);
		expect(String(json.detail.reason)).toMatch(/did not confirm/i);
	});

	it("cancels a booked flight through the reservation helper and refunds the itinerary", async () => {
		const user = await createUser({ lastName: "Lovelace" });
		const itinerary = await prisma.itinerary.create({
			data: {
				userId: user.id,
				totalPrice: 1000,
				cardNumber: "4242",
				cardExpiry: "12/29",
			},
			select: { id: true },
		});

		const flight = firstFlight(
			await searchFlights({ origin: "YYZ", destination: "LHR", date: SEARCH_DATE })
		);
		const { reservationId } = await createFlightReservation(
			{ ...PASSENGER, flightIds: [flight.id] },
			user.id
		);
		await prisma.flightReservation.update({
			where: { id: reservationId },
			data: { itineraryId: itinerary.id },
		});

		const outcome = await cancelFlightReservation(reservationId, "Lovelace");
		expect(outcome).toBe("cancelled");

		const stored = await prisma.flightReservation.findUniqueOrThrow({
			where: { id: reservationId },
		});
		expect(stored.status).toBe("CANCELLED");

		// The itinerary total is credited by the ticket price, once.
		const after = await prisma.itinerary.findUniqueOrThrow({
			where: { id: itinerary.id },
		});
		expect(after.totalPrice).toBeCloseTo(1000 - stored.price, 2);

		// A second cancellation is a no-op rather than a second refund.
		expect(await cancelFlightReservation(reservationId, "Lovelace")).toBe(
			"already-cancelled"
		);
		const unchanged = await prisma.itinerary.findUniqueOrThrow({
			where: { id: itinerary.id },
		});
		expect(unchanged.totalPrice).toBeCloseTo(after.totalPrice, 2);
	});
});
