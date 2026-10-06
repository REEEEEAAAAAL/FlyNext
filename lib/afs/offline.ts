/**
 * In-process implementation of the Advanced Flights System (AFS) contract.
 *
 * AFS (<https://github.com/Kianoosh76/afs>) is a separate Next.js service with its
 * own PostgreSQL database, and it is the system of record for a ticket. This
 * module provides the same REST contract without a network hop: the same
 * endpoints, the same request shapes and the same response payloads, including the
 * error messages, so `lib/afs-client.ts` can swap between this and HTTP without
 * the routes above it noticing.
 *
 * It is a substitute, not a stub. A stub would return a canned search result,
 * and the closed loops this project actually depends on would break on the next
 * call: booking a flight returned by an earlier search, retrieving that booking by
 * surname and reference, verifying it, cancelling it, and releasing a ticket when
 * the local write fails. So the data here is generated, mutated and retained:
 *
 * - a search returns flights whose ids state which flight they are, and whose
 *   seat counts are real state,
 * - a booking consumes a seat on every leg, decrements `availableSeats`, and
 *   returns a reference that `retrieve` and `cancel` can find again — from any
 *   worker, not only the one that took it,
 * - a cancellation marks the booking `CANCELLED` and gives the seats back, once.
 *
 * ## Determinism, and why a flight id is self-describing
 *
 * A flight id is a pure function of its route and departure time, so the same
 * search always produces the same ids — across calls, across processes and across
 * serverless invocations. That matters because a booking is a second request:
 * an id minted per search would be meaningless by the time it is submitted.
 *
 * The id also states what it refers to:
 *
 * ```
 * YYZ-LHR-20260701-0725-00
 * │   │   │        │   └─ seconds
 * │   │   │        └───── departure hour and minute, UTC
 * │   │   └────────────── timetable day
 * │   └────────────────── destination IATA
 * └────────────────────── origin IATA
 * ```
 *
 * That is what makes {@link legsFromIds} a pure function of the id: any worker can
 * decode a flight, rebuild that day's timetable and confirm the departure is one
 * the schedule actually serves, without having seen the search that produced it.
 * An opaque id — a hash of the same inputs, say — would be equally deterministic
 * and unusable here: it could only be checked against a registry of the ids this
 * process happened to have minted, and on a serverless host the process that
 * books is frequently not the one that searched. An id that is perfectly valid
 * would then be refused with "One or more flights not found", because the
 * instance checking it had never built the day it came from. The registry is
 * therefore an optimisation, never the source of truth.
 *
 * ## Bookings
 *
 * Seat inventory is derived state — every instance derives it identically from the
 * same immutable timetable — so it is cached in memory and re-derived freely. What
 * a booking takes is not: a booking is the one thing a later request has to find
 * again, so it is written to the `AfsOfflineBooking` table (see
 * `lib/afs/ledger.ts`) before this module answers. `retrieve` and `cancel` then
 * resolve it from any instance, and a cancellation gives the seats back exactly
 * once across all of them, because the release follows the stored status rather
 * than a local flag.
 *
 * Without a database this degrades to memory alone rather than failing, which is
 * correct in a single process and is what a deployment with no `DATABASE_URL`
 * gets. What it must never do is refuse a booking the caller can see in its own
 * database — hence the reservation fallback described on {@link lookupBooking}.
 *
 * ## Scope
 *
 * Only the endpoints `lib/afs-client.ts` calls are implemented. `GET /api/flights/[id]`
 * and pagination are not part of this project's traffic.
 */

/*
 * Relative imports, not the `@/` alias: `tsconfig.server.json` emits this file
 * to `dist/` as plain CommonJS so `node dist/prisma/seed.js` and the compiled
 * server bundle can run without a path-alias resolver. An aliased import here
 * compiles to `require("@/lib/api/errors")`, which Node cannot resolve, and the
 * failure only shows up at runtime rather than at build time.
 */
import { badGateway, badRequest, notFound } from "../api/errors";
import { reportEvent } from "../api/events";
import { prisma } from "../prisma";
import {
	isDurable,
	readBooking,
	soldSeats,
	setStatus,
	writeBooking,
	type BookingRecord,
} from "./ledger";
import type {
	AfsAirline,
	AfsAirport,
	AfsBooking,
	AfsBookingStatus,
	AfsCity,
	AfsCreateBookingRequest,
	AfsFlight,
	AfsFlightGroup,
	AfsFlightSearchParams,
	AfsRetrievedBooking,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

interface NetworkAirport extends AfsAirport {
	/** IATA code, e.g. `"YYZ"`. Always set here, optional on {@link AfsAirport}. */
	code: string;
}

/**
 * The route network served offline.
 *
 * Each entry is a hub with the airports it connects to. Every spoke becomes a
 * bidirectional route, which is what makes a round-trip search — the client runs
 * the reverse search separately — return results as well. A connection through a
 * hub only exists when both halves are in the graph, so the itinerary search
 * below never invents a routing the timetable cannot fly.
 *
 * The set is chosen for reach rather than realism: it covers every continent the
 * upstream AFS dataset does, so a search between two arbitrary cities has a
 * plausible answer instead of an empty list.
 */
const HUBS: readonly (NetworkAirport & { spokes: readonly string[] })[] = [
	{
		code: "YYZ",
		name: "Toronto Pearson International Airport",
		city: "Toronto",
		country: "Canada",
		spokes: ["YVR", "JFK", "LHR", "CDG", "FRA", "AMS", "ORD", "LAX", "HKG", "DXB", "DEL"],
	},
	{
		code: "JFK",
		name: "John F. Kennedy International Airport",
		city: "New York",
		country: "United States",
		spokes: [
			"ORD", "ATL", "LAX", "SFO", "MIA", "YYZ", "LHR", "CDG", "MAD", "GRU",
			"DXB",
			// See the note on LHR: a spoke's only neighbour is its hub, so an
			// airport that hangs off a hub is unreachable from anywhere that hub
			// is not directly connected to. South America needed a link on this
			// side of the Atlantic, to a hub YYZ actually serves.
			"EZE", "SCL", "BOG",
		],
	},
	{
		code: "LAX",
		name: "Los Angeles International Airport",
		city: "Los Angeles",
		country: "United States",
		spokes: ["SFO", "SEA", "ORD", "DFW", "JFK", "MEX", "NRT", "ICN", "HKG", "SYD", "AKL"],
	},
	{
		code: "LHR",
		name: "Heathrow Airport",
		city: "London",
		country: "United Kingdom",
		spokes: [
			"CDG", "FRA", "AMS", "MAD", "FCO", "IST", "DXB", "SIN", "HKG", "JFK",
			"YYZ", "JNB",
			// Reached from the far side of the network in one stop, not two: a
			// spoke's only neighbour is its hub, so an airport attached solely to a
			// secondary hub (CPT via JNB, LIS via MAD) cannot be reached from YYZ
			// within the one-stop limit the search enforces.
			"CPT", "LIS",
		],
	},
	{
		code: "CDG",
		name: "Charles de Gaulle Airport",
		city: "Paris",
		country: "France",
		spokes: ["FRA", "AMS", "MAD", "FCO", "LHR", "IST", "CAI", "DOH", "SIN", "BKK", "JFK", "YYZ"],
	},
	{
		code: "FRA",
		name: "Frankfurt Airport",
		city: "Frankfurt",
		country: "Germany",
		spokes: ["AMS", "LHR", "CDG", "IST", "VIE", "ZRH", "DEL", "PEK", "PVG", "SIN", "JFK", "YYZ"],
	},
	{
		code: "DXB",
		name: "Dubai International Airport",
		city: "Dubai",
		country: "United Arab Emirates",
		spokes: ["DOH", "DEL", "BOM", "SIN", "BKK", "HKG", "PEK", "PVG", "ICN", "NRT", "SYD", "JNB", "LHR", "JFK", "YYZ"],
	},
	{
		code: "SIN",
		name: "Singapore Changi Airport",
		city: "Singapore",
		country: "Singapore",
		spokes: ["BKK", "HKG", "PVG", "PEK", "ICN", "NRT", "DEL", "BOM", "SYD", "MEL", "AKL", "DXB", "LHR", "CDG"],
	},
	{
		code: "HKG",
		name: "Hong Kong International Airport",
		city: "Hong Kong",
		country: "Hong Kong",
		spokes: ["PVG", "PEK", "ICN", "NRT", "TPE", "SIN", "BKK", "SYD", "MEL", "DXB", "LHR", "LAX", "YYZ"],
	},
	{
		code: "ICN",
		name: "Incheon International Airport",
		city: "Seoul",
		country: "South Korea",
		spokes: ["NRT", "PEK", "PVG", "HKG", "TPE", "BKK", "SIN", "LAX", "DXB"],
	},
	{
		code: "GRU",
		name: "São Paulo/Guarulhos International Airport",
		city: "São Paulo",
		country: "Brazil",
		spokes: [
			"EZE", "BOG", "SCL", "LIM", "MIA", "JFK", "MAD", "LIS", "JNB",
			// See the note on LHR: a South American spoke hangs off GRU alone, and
			// GRU itself is only one stop from YYZ, so anything reachable from GRU
			// and nothing else would need two stops and answer no search at all.
			"ORD", "MEX",
		],
	},
	{
		code: "JNB",
		name: "O. R. Tambo International Airport",
		city: "Johannesburg",
		country: "South Africa",
		spokes: ["CPT", "CAI", "NBO", "DXB", "DOH", "LHR", "CDG", "GRU"],
	},
	/*
	 * The second tier.
	 *
	 * These are exactly the airports `prisma/seed_data/airports.json` offers in
	 * the search form's autocomplete beyond the core network. Serving a narrower
	 * set would make the dropdown a trap: picking one of the missing airports
	 * would produce "No airports found for the given origin or destination
	 * location" on a perfectly valid pair. Every airport that file lists must
	 * resolve here, and `tests/flights.offline.test.ts` asserts that it does.
	 *
	 * Each one is listed as a hub with spokes, rather than as a spoke-only
	 * airport, because a spoke only connects to its own hub: a search from a
	 * spoke to another spoke would then resolve to nothing. As a hub, an airport
	 * reaches the rest of the network both directly and through the one-stop
	 * search. Their spokes are long-haul links to the established hubs above,
	 * which keeps a Canada↔Asia or Canada↔Europe itinerary flyable.
	 */
	{
		code: "CAN",
		name: "Guangzhou Baiyun International Airport",
		city: "Guangzhou",
		country: "China",
		spokes: ["HKG", "PEK", "PVG", "SIN", "BKK", "DXB"],
	},
	{
		code: "HND",
		name: "Tokyo Haneda Airport",
		city: "Tokyo",
		country: "Japan",
		spokes: ["ICN", "TPE", "PEK", "PVG", "HKG", "SIN", "LAX"],
	},
	{
		code: "MUC",
		name: "Munich Airport",
		city: "Munich",
		country: "Germany",
		spokes: ["FRA", "VIE", "ZRH", "CDG", "AMS", "LHR", "IST"],
	},
	{
		code: "BCN",
		name: "Barcelona–El Prat Airport",
		city: "Barcelona",
		country: "Spain",
		spokes: ["MAD", "LIS", "FCO", "CDG", "FRA", "AMS", "LHR"],
	},
	{
		code: "DUB",
		name: "Dublin Airport",
		city: "Dublin",
		country: "Ireland",
		spokes: ["LHR", "CDG", "FRA", "AMS", "MAD"],
	},
	{
		code: "CPH",
		name: "Copenhagen Airport",
		city: "Copenhagen",
		country: "Denmark",
		spokes: ["ARN", "OSL", "HEL", "FRA", "AMS", "LHR"],
	},
	{
		code: "ARN",
		name: "Stockholm Arlanda Airport",
		city: "Stockholm",
		country: "Sweden",
		spokes: ["OSL", "HEL", "FRA", "AMS", "LHR"],
	},
	{
		code: "OSL",
		name: "Oslo Gardermoen Airport",
		city: "Oslo",
		country: "Norway",
		spokes: ["HEL", "FRA", "AMS", "LHR"],
	},
	{
		code: "HEL",
		name: "Helsinki Airport",
		city: "Helsinki",
		country: "Finland",
		spokes: ["FRA", "AMS", "LHR", "PRG"],
	},
	{
		code: "PRG",
		name: "Václav Havel Airport Prague",
		city: "Prague",
		country: "Czech Republic",
		spokes: ["FRA", "MUC", "VIE", "ZRH", "CDG", "AMS"],
	},
	{
		code: "BRU",
		name: "Brussels Airport",
		city: "Brussels",
		country: "Belgium",
		spokes: ["AMS", "CDG", "FRA", "LHR", "MAD", "FCO"],
	},
	{
		code: "SVO",
		name: "Sheremetyevo International Airport",
		city: "Moscow",
		country: "Russia",
		spokes: ["IST", "DXB", "PEK", "FRA", "CDG", "AMS"],
	},
	{
		code: "BOS",
		name: "Logan International Airport",
		city: "Boston",
		country: "United States",
		spokes: ["JFK", "ORD", "ATL", "MIA", "YYZ", "LHR", "DUB"],
	},
	{
		code: "IAH",
		name: "George Bush Intercontinental Airport",
		city: "Houston",
		country: "United States",
		spokes: ["ORD", "DFW", "LAX", "MIA", "MEX", "ATL"],
	},
	{
		code: "PHX",
		name: "Phoenix Sky Harbor International Airport",
		city: "Phoenix",
		country: "United States",
		spokes: ["LAX", "DFW", "ORD", "SEA", "SFO"],
	},
	{
		code: "MNL",
		name: "Ninoy Aquino International Airport",
		city: "Manila",
		country: "Philippines",
		spokes: ["HKG", "SIN", "TPE", "BKK", "ICN", "DXB"],
	},
	{
		code: "CGK",
		name: "Soekarno–Hatta International Airport",
		city: "Jakarta",
		country: "Indonesia",
		spokes: ["SIN", "KUL", "BKK", "HKG", "DXB", "SYD"],
	},
	{
		code: "KUL",
		name: "Kuala Lumpur International Airport",
		city: "Kuala Lumpur",
		country: "Malaysia",
		spokes: ["SIN", "BKK", "HKG", "DEL", "BOM", "DXB", "SYD"],
	},
	/*
	 * The third tier: the long tail of `prisma/seed_data/airports.json`, reached
	 * mostly from one continent. Listed as hubs for the same reason as the tier
	 * above — a spoke-only airport is unreachable from anywhere but its own hub,
	 * so it would answer no search at all from the far side of the network.
	 */
	{
		code: "YUL",
		name: "Montréal–Pierre Elliott Trudeau International Airport",
		city: "Montreal",
		country: "Canada",
		spokes: ["YYZ", "YOW", "YQB", "JFK", "BOS", "LHR", "CDG"],
	},
	{
		code: "YOW",
		name: "Ottawa Macdonald–Cartier International Airport",
		city: "Ottawa",
		country: "Canada",
		spokes: ["YYZ", "YUL", "YHZ", "YWG", "ORD", "LHR"],
	},
	{
		code: "YHZ",
		name: "Halifax Stanfield International Airport",
		city: "Halifax",
		country: "Canada",
		spokes: ["YYZ", "YUL", "YOW", "BOS", "JFK", "LHR"],
	},
	{
		code: "YQB",
		name: "Québec City Jean Lesage International Airport",
		city: "Québec City",
		country: "Canada",
		spokes: ["YUL", "YYZ", "YOW", "JFK"],
	},
	{
		code: "YQM",
		name: "Greater Moncton Roméo LeBlanc International Airport",
		city: "Moncton",
		country: "Canada",
		spokes: ["YHZ", "YUL", "YYZ", "BOS"],
	},
	{
		code: "YEG",
		name: "Edmonton International Airport",
		city: "Edmonton",
		country: "Canada",
		spokes: ["YYZ", "YVR", "YWG", "LAX", "ORD", "LHR"],
	},
	{
		code: "YWG",
		name: "Winnipeg Richardson International Airport",
		city: "Winnipeg",
		country: "Canada",
		spokes: ["YYZ", "YEG", "YVR", "ORD", "YOW"],
	},
	{
		code: "YYJ",
		name: "Victoria International Airport",
		city: "Victoria",
		country: "Canada",
		spokes: ["YVR", "YYZ", "SEA", "LAX"],
	},
	{
		code: "YLW",
		name: "Kelowna International Airport",
		city: "Kelowna",
		country: "Canada",
		spokes: ["YVR", "YYZ", "YEG", "SEA"],
	},
	{
		code: "YXE",
		name: "Saskatoon John G. Diefenbaker International Airport",
		city: "Saskatoon",
		country: "Canada",
		spokes: ["YYZ", "YEG", "YWG", "YVR"],
	},
	{
		code: "YQR",
		name: "Regina International Airport",
		city: "Regina",
		country: "Canada",
		spokes: ["YYZ", "YEG", "YWG", "YXE"],
	},
	{
		code: "YXX",
		name: "Abbotsford International Airport",
		city: "Abbotsford",
		country: "Canada",
		spokes: ["YVR", "YYZ", "SEA", "YYJ"],
	},
	{
		code: "YXY",
		name: "Erik Nielsen Whitehorse International Airport",
		city: "Whitehorse",
		country: "Canada",
		spokes: ["YVR", "YYZ", "YEG"],
	},
	{
		code: "YZF",
		name: "Yellowknife Airport",
		city: "Yellowknife",
		country: "Canada",
		spokes: ["YEG", "YYZ", "YVR", "YWG"],
	},
	{
		code: "YTZ",
		name: "Billy Bishop Toronto City Airport",
		city: "Toronto",
		country: "Canada",
		spokes: ["YOW", "YUL", "YHZ", "JFK", "BOS"],
	},
	{
		code: "WAW",
		name: "Warsaw Chopin Airport",
		city: "Warsaw",
		country: "Poland",
		spokes: ["FRA", "AMS", "CDG", "LHR", "VIE", "PRG"],
	},
	{
		code: "BUD",
		name: "Budapest Ferenc Liszt International Airport",
		city: "Budapest",
		country: "Hungary",
		spokes: ["FRA", "VIE", "MUC", "AMS", "CDG", "LHR"],
	},
	{
		code: "OTP",
		name: "Henri Coandă International Airport",
		city: "Bucharest",
		country: "Romania",
		spokes: ["FRA", "MUC", "VIE", "IST", "AMS"],
	},
	{
		code: "ATH",
		name: "Athens International Airport",
		city: "Athens",
		country: "Greece",
		spokes: ["FCO", "MUC", "FRA", "IST", "CDG", "LHR"],
	},
	{
		code: "LGW",
		name: "London Gatwick Airport",
		city: "London",
		country: "United Kingdom",
		spokes: ["MAD", "FCO", "CDG", "AMS", "DXB", "JFK"],
	},
	{
		code: "TLV",
		name: "Ben Gurion Airport",
		city: "Tel Aviv",
		country: "Israel",
		spokes: ["IST", "FCO", "LHR", "CDG", "FRA", "DXB"],
	},
	{
		code: "JED",
		name: "King Abdulaziz International Airport",
		city: "Jeddah",
		country: "Saudi Arabia",
		spokes: ["DXB", "DOH", "CAI", "IST", "DEL"],
	},
	{
		code: "AUH",
		name: "Zayed International Airport",
		city: "Abu Dhabi",
		country: "United Arab Emirates",
		spokes: ["DXB", "DOH", "DEL", "BOM", "SIN", "LHR"],
	},
	{
		code: "CMB",
		name: "Bandaranaike International Airport",
		city: "Colombo",
		country: "Sri Lanka",
		spokes: ["DXB", "DOH", "SIN", "KUL", "DEL", "BOM"],
	},
	{
		code: "SGN",
		name: "Tan Son Nhat International Airport",
		city: "Ho Chi Minh City",
		country: "Vietnam",
		spokes: ["SIN", "BKK", "HKG", "KUL", "TPE", "ICN"],
	},
	{
		code: "DAL",
		name: "Dallas Love Field",
		city: "Dallas",
		country: "United States",
		spokes: ["DFW", "IAH", "ORD", "LAX", "PHX"],
	},
	{
		code: "HNL",
		name: "Daniel K. Inouye International Airport",
		city: "Honolulu",
		country: "United States",
		spokes: ["LAX", "SFO", "SEA", "PHX", "NRT", "SYD"],
	},
	/*
	 * Two South American airports that had to become hubs rather than spokes of
	 * GRU. A spoke connects only to its own hub, so hanging them off GRU put
	 * them two stops from the trunk — reachable from each other and from GRU,
	 * and from nowhere else, which the one-stop search answers with an empty
	 * list. Every airport the search form offers has to be reachable from every
	 * other one, in both directions.
	 */
	{
		code: "BOG",
		name: "El Dorado International Airport",
		city: "Bogotá",
		country: "Colombia",
		spokes: ["MIA", "JFK", "MEX", "GRU", "LIM", "MAD", "SCL"],
	},
	{
		code: "SCL",
		name: "Arturo Merino Benítez International Airport",
		city: "Santiago",
		country: "Chile",
		spokes: ["EZE", "LIM", "GRU", "MIA", "MAD", "BOG", "SYD"],
	},
];

/** Extra airports reachable only through a hub, kept for the connection search. */
const SPOKE_ONLY: readonly NetworkAirport[] = [
	{ code: "YVR", name: "Vancouver International Airport", city: "Vancouver", country: "Canada" },
	{ code: "ORD", name: "O'Hare International Airport", city: "Chicago", country: "United States" },
	{ code: "ATL", name: "Hartsfield–Jackson Atlanta International Airport", city: "Atlanta", country: "United States" },
	{ code: "SFO", name: "San Francisco International Airport", city: "San Francisco", country: "United States" },
	{ code: "SEA", name: "Seattle–Tacoma International Airport", city: "Seattle", country: "United States" },
	{ code: "DFW", name: "Dallas/Fort Worth International Airport", city: "Dallas", country: "United States" },
	{ code: "MIA", name: "Miami International Airport", city: "Miami", country: "United States" },
	{ code: "MEX", name: "Mexico City International Airport", city: "Mexico City", country: "Mexico" },
	{ code: "AMS", name: "Amsterdam Airport Schiphol", city: "Amsterdam", country: "Netherlands" },
	{ code: "MAD", name: "Adolfo Suárez Madrid–Barajas Airport", city: "Madrid", country: "Spain" },
	{ code: "FCO", name: "Leonardo da Vinci–Fiumicino Airport", city: "Rome", country: "Italy" },
	{ code: "IST", name: "Istanbul Airport", city: "Istanbul", country: "Türkiye" },
	{ code: "VIE", name: "Vienna International Airport", city: "Vienna", country: "Austria" },
	{ code: "ZRH", name: "Zurich Airport", city: "Zurich", country: "Switzerland" },
	{ code: "LIS", name: "Humberto Delgado Airport", city: "Lisbon", country: "Portugal" },
	{ code: "DOH", name: "Hamad International Airport", city: "Doha", country: "Qatar" },
	{ code: "DEL", name: "Indira Gandhi International Airport", city: "Delhi", country: "India" },
	{ code: "BOM", name: "Chhatrapati Shivaji Maharaj International Airport", city: "Mumbai", country: "India" },
	{ code: "PEK", name: "Beijing Capital International Airport", city: "Beijing", country: "China" },
	{ code: "PVG", name: "Shanghai Pudong International Airport", city: "Shanghai", country: "China" },
	{ code: "NRT", name: "Narita International Airport", city: "Tokyo", country: "Japan" },
	{ code: "TPE", name: "Taiwan Taoyuan International Airport", city: "Taipei", country: "Taiwan" },
	{ code: "BKK", name: "Suvarnabhumi Airport", city: "Bangkok", country: "Thailand" },
	{ code: "SYD", name: "Sydney Kingsford Smith Airport", city: "Sydney", country: "Australia" },
	{ code: "MEL", name: "Melbourne Airport", city: "Melbourne", country: "Australia" },
	{ code: "AKL", name: "Auckland Airport", city: "Auckland", country: "New Zealand" },
	{ code: "CAI", name: "Cairo International Airport", city: "Cairo", country: "Egypt" },
	{ code: "NBO", name: "Jomo Kenyatta International Airport", city: "Nairobi", country: "Kenya" },
	{ code: "CPT", name: "Cape Town International Airport", city: "Cape Town", country: "South Africa" },
	{ code: "EZE", name: "Ministro Pistarini International Airport", city: "Buenos Aires", country: "Argentina" },
	{ code: "LIM", name: "Jorge Chávez International Airport", city: "Lima", country: "Peru" },
];

/** Airlines legs are attributed to. Codes and names match the upstream dataset. */
const AIRLINES: readonly AfsAirline[] = [
	{ code: "AC", name: "Air Canada" },
	{ code: "AA", name: "American Airlines" },
	{ code: "DL", name: "Delta Air Lines" },
	{ code: "UA", name: "United Airlines" },
	{ code: "BA", name: "British Airways" },
	{ code: "AF", name: "Air France" },
	{ code: "LH", name: "Lufthansa" },
	{ code: "KL", name: "KLM Royal Dutch Airlines" },
	{ code: "EK", name: "Emirates" },
	{ code: "QR", name: "Qatar Airways" },
	{ code: "SQ", name: "Singapore Airlines" },
	{ code: "CX", name: "Cathay Pacific" },
	{ code: "JL", name: "Japan Airlines" },
	{ code: "KE", name: "Korean Air" },
	{ code: "QF", name: "Qantas" },
	{ code: "ET", name: "Ethiopian Airlines" },
];

/** Airport lookup, built once per process from the two lists above. */
const AIRPORTS: readonly NetworkAirport[] = [
	...HUBS.map(({ spokes: _spokes, ...airport }) => airport),
	...SPOKE_ONLY,
];

const AIRPORT_BY_CODE = new Map(AIRPORTS.map((airport) => [airport.code, airport]));

/** Every route in the network, both directions, as `"ORIGIN>DEST"` keys. */
const ROUTES: ReadonlySet<string> = buildRoutes();

/** Adjacency set used by the connection search, as `"ORIGIN>HUB"` keys. */
const ADJACENCY: ReadonlySet<string> = ROUTES;

function buildRoutes(): ReadonlySet<string> {
	const routes = new Set<string>();
	for (const hub of HUBS) {
		for (const spokeCode of hub.spokes) {
			if (!AIRPORT_BY_CODE.has(spokeCode)) {
				throw new Error(
					`OFFLINE_AIRPORTS is inconsistent: hub ${hub.code} lists unknown spoke ${spokeCode}`
				);
			}
			routes.add(`${hub.code}>${spokeCode}`);
			routes.add(`${spokeCode}>${hub.code}`);
		}
	}
	return routes;
}

/* -------------------------------------------------------------------------- */
/* Deterministic randomness and geometry                                      */
/* -------------------------------------------------------------------------- */

/** FNV-1a, 32-bit. Small, dependency free, and stable across Node versions. */
function hash32(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Build a seeded generator: a 32-bit xorshift.
 *
 * Used instead of `Math.random()` so that a route's timetable is identical on
 * every rebuild — a regenerated day must price and number its flights the same
 * way, or a booking made before an eviction would refer to a flight that no
 * longer exists in that shape.
 */
function seedRandom(seed: string): () => number {
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

/** An integer in `[min, max]`, inclusive. */
function intBetween(random: () => number, min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1));
}

/** Pick one element of a non-empty array. */
function pick<T>(random: () => number, values: readonly T[]): T {
	return values[Math.floor(random() * values.length)] as T;
}

/** Great-circle distance in kilometres. */
function distanceKm(from: NetworkAirport, to: NetworkAirport): number {
	/**
	 * Coordinates by IATA code: `[latitude, longitude]` in decimal degrees.
	 *
	 * Every airport in {@link AIRPORTS} must appear here. A missing entry does not
	 * throw — {@link blockMinutes} silently falls back to a flat 5000 km estimate,
	 * which would price and schedule that airport's entire timetable wrongly. The
	 * coverage is asserted in `tests/flights.offline.test.ts`.
	 */
	const coordinates: Record<string, [number, number]> = {
		YYZ: [43.68, -79.63], YVR: [49.19, -123.18], JFK: [40.64, -73.78],
		LAX: [33.94, -118.41], ORD: [41.98, -87.9], ATL: [33.64, -84.43],
		SFO: [37.62, -122.38], SEA: [47.45, -122.31], DFW: [32.9, -97.04],
		MIA: [25.79, -80.29], MEX: [19.44, -99.07], LHR: [51.47, -0.45],
		CDG: [49.01, 2.55], FRA: [50.03, 8.57], AMS: [52.31, 4.76],
		MAD: [40.47, -3.56], FCO: [41.8, 12.25], IST: [41.26, 28.74],
		VIE: [48.11, 16.57], ZRH: [47.46, 8.55], LIS: [38.77, -9.13],
		DOH: [25.27, 51.61], DXB: [25.25, 55.36], DEL: [28.56, 77.1],
		BOM: [19.09, 72.87], PEK: [40.08, 116.58], PVG: [31.14, 121.81],
		HKG: [22.31, 113.91], ICN: [37.46, 126.44], NRT: [35.77, 140.39],
		TPE: [25.08, 121.23], BKK: [13.69, 100.75], SIN: [1.36, 103.99],
		SYD: [-33.94, 151.18], MEL: [-37.67, 144.84], AKL: [-37.01, 174.79],
		CAI: [30.11, 31.41], NBO: [-1.32, 36.93], JNB: [-26.14, 28.25],
		CPT: [-33.97, 18.6], GRU: [-23.43, -46.47], EZE: [-34.82, -58.54],
		BOG: [4.7, -74.15], SCL: [-33.39, -70.79], LIM: [-12.02, -77.11],
		// The second-tier airports above; sourced from the OpenFlights dataset.
		CAN: [23.39, 113.3], HND: [35.55, 139.78], MUC: [48.35, 11.79],
		BCN: [41.3, 2.08], DUB: [53.42, -6.27], CPH: [55.62, 12.66],
		ARN: [59.65, 17.92], OSL: [60.12, 11.05], HEL: [60.32, 24.96],
		PRG: [50.1, 14.26], BRU: [50.9, 4.48], SVO: [55.97, 37.41],
		BOS: [42.36, -71.01], IAH: [29.98, -95.34], PHX: [33.43, -112.01],
		MNL: [14.51, 121.02], CGK: [-6.13, 106.66], KUL: [2.75, 101.71],
		// The third tier; also from the OpenFlights dataset.
		YUL: [45.47, -73.74], YOW: [45.32, -75.67], YHZ: [44.88, -63.51],
		YQB: [46.79, -71.39], YQM: [46.11, -64.68], YEG: [53.31, -113.58],
		YWG: [49.91, -97.24], YYJ: [48.65, -123.43], YLW: [49.96, -119.38],
		YXE: [52.17, -106.7], YQR: [50.43, -104.67], YXX: [49.03, -122.36],
		YXY: [60.71, -135.07], YZF: [62.46, -114.44], YTZ: [43.63, -79.4],
		WAW: [52.17, 20.97], BUD: [47.43, 19.26], OTP: [44.57, 26.09],
		ATH: [37.94, 23.94], LGW: [51.15, -0.19], TLV: [32.01, 34.89],
		JED: [21.68, 39.16], AUH: [24.43, 54.65], CMB: [7.18, 79.88],
		SGN: [10.82, 106.65], DAL: [32.85, -96.85], HNL: [21.32, -157.92],
	};

	const fromPoint = coordinates[from.code];
	const toPoint = coordinates[to.code];
	if (fromPoint === undefined || toPoint === undefined) {
		// Not reachable for the network above; a flat estimate beats a crash.
		return 5_000;
	}
	const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
	const [lat1, lon1] = fromPoint.map(toRadians) as [number, number];
	const [lat2, lon2] = toPoint.map(toRadians) as [number, number];
	const a =
		Math.sin((lat2 - lat1) / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
	return Math.round(6_371 * 2 * Math.asin(Math.min(1, Math.sqrt(a))));
}

/**
 * Block time in minutes: the great-circle distance at an average 820 km/h, plus
 * 40 minutes of taxi, climb and descent, rounded up to a multiple of five.
 */
function blockMinutes(from: NetworkAirport, to: NetworkAirport): number {
	const raw = (distanceKm(from, to) / 820) * 60 + 40;
	return Math.max(55, Math.ceil(raw / 5) * 5);
}

/** Price in USD: distance based, with a deterministic per-flight spread. */
function priceFor(random: () => number, minutes: number): number {
	const base = 45 + minutes * 0.72;
	const spread = 0.82 + random() * 0.46;
	return Math.round(base * spread * 100) / 100;
}

/** ISO-8601 duration, e.g. `"PT2H35M"`, the format AFS returns. */
function isoDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : ""}` || "PT0M";
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

interface StoredBooking {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	passportNumber: string;
	status: string;
	flightIds: string[];
	/** When the booking was taken, as the ledger stores it. */
	createdAt: Date;
	/**
	 * True when {@link AfsOfflineBooking} holds this booking too.
	 *
	 * Copying the ledger's rows into this map is what keeps a repeat lookup inside
	 * the process from paying another round trip. The flag is what stops the copy
	 * from making the booking look durable when the write that was supposed to
	 * create it failed: a booking only this worker knows about must not be allowed
	 * to shadow a database row that says otherwise.
	 */
	durable: boolean;
}

interface AfsStore {
	/** Flights by id, so a booking can be validated against what was returned. */
	flights: Map<string, AfsFlight>;
	/**
	 * Flight ids in registration order, for bounded eviction. Entries are only
	 * appended here, and {@link AfsStore.pruneCursor} walks the list once, so it
	 * is longer than `flights` by exactly the number of retained live entries
	 * behind the cursor.
	 */
	flightOrder: string[];
	/**
	 * How far the eviction walk below has consumed `flightOrder`.
	 *
	 * The walk has to skip flights that have not departed — those are the ones
	 * a user can still book — so it cannot simply drop the head of the list.
	 * Holding a cursor instead makes the whole thing amortised constant time:
	 * every entry is examined at most once in the process's life, rather than
	 * rescanning the list on every registration.
	 */
	pruneCursor: number;
	/**
	 * The seat count each flight was published with, by flight id.
	 *
	 * Written the first time a flight is built and never again, which is what
	 * makes it a property of the route and the day rather than of this process's
	 * history. It has to be cached because the count is drawn from the timetable's
	 * seeded generator: a rebuild after an eviction must produce the same number,
	 * or a flight would silently gain seats.
	 *
	 * It is deliberately not the live count. Availability is this minus the
	 * seats taken, and the seats taken are what the booking ledger holds — see
	 * `availableSeats` in the seats section. Keeping one number here and updating
	 * it on every sale is what made a cancellation depend on which worker sold the
	 * seat, and made a flight's capacity drift every time the timetable was
	 * rebuilt.
	 */
	capacity: Map<string, number>;
	/** Built timetables, keyed `"YYYY-MM-DD"`, in insertion order. */
	days: Map<string, AfsFlight[]>;
	dayOrder: string[];
	bookings: Map<string, StoredBooking>;
	/** Mode decisions already reported, so the log gets one line per reason. */
	reportedModes: Set<string>;
	/**
	 * Ledger failures already reported, so a database that is down logs once
	 * rather than once per request. Keyed by operation and error code.
	 */
	ledgerFailures: Set<string>;
}

/**
 * The store, pinned to `globalThis`.
 *
 * Next.js reloads route modules on every edit in development, so a plain module
 * level object would drop every booking each time a file is saved. The symbol key
 * keeps one store per process without colliding with anything else on `globalThis`.
 */
const STORE_KEY = Symbol.for("flynext.afs.offline.store");

function getStore(): AfsStore {
	const host = globalThis as unknown as Record<symbol, AfsStore | undefined>;
	let store = host[STORE_KEY];
	if (store === undefined) {
		store = {
			flights: new Map(),
			flightOrder: [],
			pruneCursor: 0,
			capacity: new Map(),
			days: new Map(),
			dayOrder: [],
			bookings: new Map(),
			reportedModes: new Set(),
			ledgerFailures: new Set(),
		};
		host[STORE_KEY] = store;
	}
	return store;
}

/** Timetables kept in memory. Each is a full day of the network. */
const MAX_CACHED_DAYS = 32;

/**
 * Flights kept in the id registry, so a long-lived process cannot grow forever.
 *
 * Sized in days of network, not in raw flights: one built day registers an
 * entry for every route in the network, which the current airport set puts at
 * roughly 2,400. A budget below two days' worth would be a correctness problem
 * rather than a memory one — a round trip searches two dates, so the second
 * search would evict the first date's flights and booking an itinerary the user
 * was still looking at would fail with "One or more flights not found". This
 * budget is a little over six days, which is more than a real search session
 * accumulates before it books, while still bounding a process that runs for
 * months.
 */
const MAX_REGISTERED_FLIGHTS = 15_000;

/**
 * How far below the budget the live-inventory eviction aims, and therefore how
 * often its scan of `flightOrder` runs: once per {@link EVICTION_BATCH}
 * registrations rather than on every one.
 */
const EVICTION_TARGET = 14_000;
const EVICTION_BATCH = 1_000;

/**
 * Register a flight so a later booking can validate the id it was given.
 *
 * Eviction is bookability aware: a flight that has not departed yet is
 * inventory the user can still buy, so the eviction walk drops already-departed
 * flights and leaves the live ones in place. Evicting strictly by insertion
 * order — which is what this did — discards today's flights because a later
 * search built tomorrow's, and the failure surfaces at booking time, far from
 * its cause, as "One or more flights not found".
 *
 * The guarantee this gives is: as long as the registry holds fewer live flights
 * than the budget, no flight a user could still book is ever dropped. Once live
 * flights alone exceed the budget (a process that has been up for weeks, or a
 * pathological burst of searches) the oldest live ones go too — the alternative
 * would be unbounded memory.
 *
 * `store.capacity` is deliberately not pruned here. It holds the live seat
 * count for every flight that has been booked from, which is exactly the state a
 * later rebuild of that flight reads back (see `makeFlight`); dropping it would
 * resurrect the seats a booking already sold. It grows only with real bookings,
 * so it needs no cap of its own.
 */
function register(store: AfsStore, flight: AfsFlight): void {
	if (!store.flights.has(flight.id)) {
		store.flightOrder.push(flight.id);
	}
	store.flights.set(flight.id, flight);

	pruneRegistry(store);
}

/**
 * Bring the registry back under {@link MAX_REGISTERED_FLIGHTS}.
 *
 * Walks `flightOrder` from {@link AfsStore.pruneCursor}, deleting departed
 * flights and stopping as soon as the registry fits. The cursor advances past
 * every entry it examines, so each id is inspected at most once for the life of
 * the process — the cost is amortised constant time per registration rather than
 * a rescan of a 15,000-entry list on every call.
 *
 * When the walk reaches the end of the list and the registry is still over
 * budget, every remaining entry is a live flight, so the oldest live ones are
 * dropped as well. That is the only case where a bookable flight can be lost,
 * and it is batched down to `EVICTION_TARGET` so the fresh scan it needs runs
 * once per {@link EVICTION_BATCH} registrations rather than once per flight.
 */
function pruneRegistry(store: AfsStore): void {
	if (store.flights.size <= MAX_REGISTERED_FLIGHTS) {
		return;
	}

	const now = Date.now();
	while (
		store.pruneCursor < store.flightOrder.length &&
		store.flights.size > MAX_REGISTERED_FLIGHTS
	) {
		const id = store.flightOrder[store.pruneCursor]!;
		store.pruneCursor += 1;

		const registered = store.flights.get(id);
		if (registered === undefined) {
			// Already evicted; the order entry is stale.
			continue;
		}
		if (Date.parse(registered.departureTime) < now) {
			store.flights.delete(id);
		}
	}

	if (store.flights.size <= MAX_REGISTERED_FLIGHTS) {
		return;
	}

	// Every id still registered departs in the future, so the only thing left to
	// evict is live inventory. Drop a batch of the oldest.
	let budget = store.flights.size - EVICTION_TARGET;
	for (const id of store.flightOrder) {
		if (budget <= 0) {
			break;
		}
		if (store.flights.delete(id)) {
			budget -= 1;
		}
	}
}

/** Drop the oldest timetables once the cache is full. */
function evictDays(store: AfsStore): void {
	while (store.dayOrder.length > MAX_CACHED_DAYS) {
		const evicted = store.dayOrder.shift();
		if (evicted !== undefined) {
			store.days.delete(evicted);
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Timetable generation                                                       */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` for a `Date`, in UTC to match how AFS parses a bare date. */
function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Parse the `date` query parameter, which AFS documents as `YYYY-MM-DD`.
 *
 * `new Date("2026-07-01")` is midnight UTC, and that is what the upstream
 * service compares against, so the day window below is built the same way.
 */
function parseIsoDay(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Deterministic, self-describing flight id.
 *
 * The same route and departure always produce the same id — and, unlike a hash,
 * an id states the route and the departure it came from, so any worker can decode
 * it, rebuild that day's timetable and check the departure is one the schedule
 * serves. See the note on determinism at the top of this file for what that buys.
 *
 * Departure times are generated on a five-minute grid, so the seconds are always
 * `00`; they are still encoded, because an id that silently dropped them could
 * not be verified against the departure time it names.
 */
function flightId(from: NetworkAirport, to: NetworkAirport, departure: Date): string {
	const iso = departure.toISOString();
	const day = iso.slice(0, 10).replace(/-/g, "");
	const time = iso.slice(11, 19).replace(/:/g, "");
	return `${from.code}-${to.code}-${day}-${time.slice(0, 4)}-${time.slice(4, 6)}`;
}

/** A decoded {@link flightId}: everything needed to reproduce the flight. */
interface FlightKey {
	origin: string;
	destination: string;
	/** `YYYY-MM-DD`. */
	day: string;
	/** ISO-8601 departure timestamp, to the second. */
	departure: string;
}

/** `YYZ-LHR-20260701-0725-00`, the id {@link flightId} writes. */
const FLIGHT_ID_PATTERN = /^([A-Z]{3})-([A-Z]{3})-(\d{8})-(\d{4})-(\d{2})$/;

/**
 * Decode a flight id, rejecting anything that is not one.
 *
 * Checking the route against {@link ROUTES} here as well as in
 * {@link flightFromKey} is deliberate: a malformed id and an id for a route the
 * network does not fly are both "no such flight", and answering before the
 * timetable is built keeps a garbage id from forcing a day's generation.
 *
 * @returns the decoded key, or `undefined` when `id` is not a flight id this
 *   network could have minted.
 */
function flightKeyFromId(id: string): FlightKey | undefined {
	const match = FLIGHT_ID_PATTERN.exec(id);
	if (match === null) {
		return undefined;
	}
	const [, origin, destination, day, hhmm, ss] = match as unknown as [
		string,
		string,
		string,
		string,
		string,
		string,
	];

	if (!AIRPORT_BY_CODE.has(origin) || !AIRPORT_BY_CODE.has(destination)) {
		return undefined;
	}
	if (!ROUTES.has(`${origin}>${destination}`)) {
		return undefined;
	}

	const isoDayPart = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
	const departure = new Date(
		`${isoDayPart}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:${ss}.000Z`
	);
	if (Number.isNaN(departure.getTime())) {
		return undefined;
	}
	// A day that does not survive the round trip (`2026-02-31`) is not a day.
	if (isoDay(departure) !== isoDayPart) {
		return undefined;
	}

	return {
		origin,
		destination,
		day: isoDayPart,
		departure: departure.toISOString(),
	};
}

/**
 * The flight a {@link FlightKey} names, or `undefined` when the timetable does
 * not serve it.
 *
 * The timetable is the authority, not the key: an id can only be legitimate if
 * some search could have produced it, and the schedule is what answers that. This
 * is the check that replaces "is it in this worker's registry".
 */
async function flightFromKey(key: FlightKey): Promise<AfsFlight | undefined> {
	const registered = getStore().flights.get(renderFlightId(key));
	if (registered !== undefined) {
		return registered;
	}
	const departure = Date.parse(key.departure);
	for (const flight of await dayFlights(key.day)) {
		if (flight.origin.code !== key.origin || flight.destination.code !== key.destination) {
			continue;
		}
		if (Date.parse(flight.departureTime) === departure) {
			return flight;
		}
	}
	return undefined;
}

/** Re-render a key as the id it was decoded from. */
function renderFlightId(key: FlightKey): string {
	const day = key.day.replace(/-/g, "");
	const time = key.departure.slice(11, 19).replace(/:/g, "");
	return `${key.origin}-${key.destination}-${day}-${time.slice(0, 4)}-${time.slice(4, 6)}`;
}

/*
 * Ids minted before the format above.
 *
 * They were hashes that also had to look like a UUID, so they carried millis
 * since the epoch spread over characters 26+ rather than a readable date, and
 * there is no way to tell one from a real v4 uuid. The only thing that can
 * resolve them is the timetable they came from, which is why the scan below is
 * bounded: it only runs for an id that is not the current format, and a
 * genuine uuid from somewhere else fails all of them.
 *
 * Kept because the provider must be able to resolve every booking its caller can
 * still see, and `retrieve` and `cancel` are exactly the requests that must never
 * start failing on an older record. Ids are never minted in this form.
 */
const LEGACY_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

/** How many days either side of a legacy id's own timestamp to search. */
const LEGACY_SEARCH_DAYS = 1;

/** The day and hour a legacy id encodes, or `undefined` if it encodes neither. */
function legacyHint(id: string): { day: string; hour: number } | undefined {
	if (!LEGACY_UUID_PATTERN.test(id)) {
		return undefined;
	}
	const tail = id.slice(26).replace(/-/g, "");
	if (tail.length < 10) {
		return undefined;
	}
	const millis = Number.parseInt(tail.slice(0, 9), 16);
	const hour = tail.charCodeAt(9) - 48;
	if (!Number.isFinite(millis) || hour < 0 || hour > 23) {
		return undefined;
	}
	const stamp = new Date(millis * 60_000 + hour * 3_600_000);
	if (Number.isNaN(stamp.getTime())) {
		return undefined;
	}
	return { day: isoDay(stamp), hour };
}

/**
 * Resolve an id minted in the legacy hash format by looking for it in the
 * timetables it could have come from.
 *
 * @returns the flight, or `undefined` when no nearby day serves that id.
 */
async function legacyFlight(id: string): Promise<AfsFlight | undefined> {
	const hint = legacyHint(id);
	if (hint === undefined) {
		return undefined;
	}

	for (let offset = -LEGACY_SEARCH_DAYS; offset <= LEGACY_SEARCH_DAYS; offset += 1) {
		const day = new Date(`${hint.day}T00:00:00.000Z`).getTime() + offset * 86_400_000;
		for (const flight of await dayFlights(isoDay(new Date(day)))) {
			if (flight.id === id) {
				return flight;
			}
		}
	}
	return undefined;
}

/**
 * Resolve `id` on this instance, whatever it was minted on.
 *
 * The registry first — it is the same object a search just handed the caller, so
 * a booking in the same process never rebuilds a timetable — then the id itself.
 */
async function resolveFlight(id: string): Promise<AfsFlight | undefined> {
	const store = getStore();
	const registered = store.flights.get(id);
	if (registered !== undefined) {
		return registered;
	}
	const key = flightKeyFromId(id);
	if (key !== undefined) {
		return flightFromKey(key);
	}
	return legacyFlight(id);
}

/** A UUID-shaped booking id, mirroring the upstream `Booking.id` column. */
function bookingId(): string {
	return getBookingIdFactory()();
}

/** How booking ids are minted. Defaults to `crypto.randomUUID()`. */
function defaultBookingId(): string {
	return crypto.randomUUID();
}

/**
 * Where the booking-id generator lives.
 *
 * Like the store, it is pinned to `globalThis` rather than held in a module
 * binding. A test that installs a generator has to be read by the same code that
 * mints the id, and a bundler is free to hand two importers two module instances
 * — at which point a module-level `let` would leave the injection invisible.
 */
const BOOKING_ID_FACTORY_KEY = Symbol.for("flynext.afs.offline.bookingIdFactory");

function getBookingIdFactory(): () => string {
	const host = globalThis as unknown as Record<symbol, (() => string) | undefined>;
	return host[BOOKING_ID_FACTORY_KEY] ?? defaultBookingId;
}

/**
 * Replace the booking-id generator. Test seam — production behaviour is
 * otherwise entirely deterministic, and nothing in the app should call this.
 *
 * It exists for one scenario that cannot be produced any other way: a duplicate
 * booking reference, which is what makes the local `afsBookingId` unique index
 * reject a booking the provider accepted. Everything else stays real.
 *
 * @returns the generator that was installed, so a test can restore it.
 */
export function setBookingIdFactory(next: () => string): () => string {
	const host = globalThis as unknown as Record<symbol, (() => string) | undefined>;
	const previous = getBookingIdFactory();
	host[BOOKING_ID_FACTORY_KEY] = next;
	return previous;
}

/** Restore the default booking-id generator. */
export function resetBookingIdFactory(): void {
	const host = globalThis as unknown as Record<symbol, (() => string) | undefined>;
	delete host[BOOKING_ID_FACTORY_KEY];
}

/**
 * Drop the cached timetables, forcing the next search for a date to rebuild it.
 * Test seam — production code must not call this.
 *
 * The rebuild path is where a deterministic flight id can meet a registry entry
 * that already carries live state (sold seats, a cancelled leg), so a test needs a
 * way to reach it without waiting for the cache to fill up on its own.
 */
export function dropTimetables(): void {
	const store = getStore();
	store.days.clear();
	store.dayOrder.length = 0;
}

/**
 * Empty the flight id registry and the timetable cache. Test seam —
 * production code must not call it.
 *
 * A suite that deliberately drives the registry past its budget (to prove the
 * bound holds) leaves later cases without the ids they just searched for, and
 * the failure reads as "One or more flights not found" in an unrelated test.
 *
 * Both halves have to go together. A cached day holds the live flight objects
 * it built, and it is returned as-is on a cache hit without re-registering them,
 * so clearing the registry alone would hand out flights that can no longer be
 * booked. Restoration is free and faithful: ids are deterministic, so the next
 * search rebuilds the same flights, and the sold-seat counts live in `capacity`
 * rather than in either — that map is intentionally left alone.
 */
export function resetFlightRegistry(): void {
	const store = getStore();
	store.flights.clear();
	store.flightOrder.length = 0;
	store.pruneCursor = 0;
	dropTimetables();
}

/**
 * Forget the bookings this process is holding. Test seam — test-only, like the
 * two above.
 *
 * Bookings are the one thing here that is not derivable: a booking whose
 * ledger write did not reach the database lives only in this map, and a suite
 * that empties `AfsOfflineBooking` between cases would otherwise keep serving
 * it. Because flight ids are deterministic, a stale booking would even be found
 * again for a flight the next case searches for — which is the one thing
 * {@link lookupBooking} must not do once the ledger has been cleared.
 *
 * The live seat counts go with them, for the same reason and with the same
 * timing: `held` is a view of the bookings, so clearing one without the other
 * leaves a flight looking sold out that nothing has sold.
 *
 * `capacity` is deliberately kept. It holds the seat count each flight was
 * published with, which is a property of the route and the day rather than of any
 * booking; dropping it would let a cached timetable — whose flight objects are
 * returned as-is — disagree with a rebuilt one about how many seats a flight has.
 */
export function resetBookingLedger(): void {
	const store = getStore();
	store.bookings.clear();
	store.ledgerFailures.clear();
}

/**
 * Build one flight.
 *
 * `availableSeats` is the published count, not the live one: a flight is built
 * from its route and day alone, so the number of seats still free is not
 * something this function can know — another worker may have sold some. It writes
 * the published count to the registry instead, and the booking path subtracts
 * what the ledger says has been sold. Rebuilding a day therefore cannot resurrect
 * a sold seat, which is the property that matters.
 */
function makeFlight(
	store: AfsStore,
	from: NetworkAirport,
	to: NetworkAirport,
	departure: Date,
	random: () => number
): AfsFlight {
	const minutes = blockMinutes(from, to);
	const arrival = new Date(departure.getTime() + minutes * 60_000);
	const airline = pick(random, AIRLINES);
	const id = flightId(from, to, departure);

	/*
	 * Every draw here is made unconditionally, in a fixed order, because `random`
	 * is the whole day's generator for this route: skipping one — which is what
	 * `store.capacity.get(id) ?? intBetween(random, …)` does on a rebuild —
	 * shifts every later slot on the route, and the day stops being reproducible.
	 * The published count is a cache of the first draw, not a different timetable.
	 */
	const drawn = intBetween(random, 12, 240);
	const flightNumber = `${airline.code}${intBetween(random, 100, 999)}`;
	// First sight of this flight fixes its capacity for the life of the process.
	const seats = store.capacity.get(id) ?? drawn;
	store.capacity.set(id, seats);

	return {
		id,
		flightNumber,
		airline: { code: airline.code, name: airline.name },
		departureTime: departure.toISOString(),
		arrivalTime: arrival.toISOString(),
		duration: isoDuration(minutes),
		durationMinutes: minutes,
		origin: { ...from },
		destination: { ...to },
		price: priceFor(random, minutes),
		currency: "USD",
		availableSeats: seats,
		status: "SCHEDULED",
	};
}

/**
 * Every flight departing on `date`, for every route in the network.
 *
 * A hub departs to each of its spokes a few times a day and a spoke departs to
 * its hub the same number of times, which is what makes both the direct search
 * and the one-stop search below find something. The whole day is built at once —
 * rather than only the routes a single query needs — because the connection
 * search has to reason across routes, and because one build can then serve every
 * query for that date.
 *
 * The loop runs over {@link ROUTES} rather than over each hub's spoke list.
 * Several hubs are also each other's spokes (`YYZ` lists `JFK`, `JFK` lists
 * `YYZ`), so walking the spoke lists would visit a hub-to-hub route twice and
 * mint two identical flights — same id, same departure time, same price. Both
 * would then be returned by a search, and the results page would show the same
 * itinerary twice with the two tick-boxes wired to one id.
 */
function buildDay(dateIso: string): AfsFlight[] {
	const store = getStore();
	const start = parseIsoDay(dateIso);
	if (start === null) {
		return [];
	}

	const flights: AfsFlight[] = [];
	for (const route of ROUTES) {
		const [fromCode, toCode] = route.split(">") as [string, string];
		const from = AIRPORT_BY_CODE.get(fromCode);
		const to = AIRPORT_BY_CODE.get(toCode);
		if (from === undefined || to === undefined) {
			continue;
		}

		const random = seedRandom(`${from.code}>${to.code}@${dateIso}`);
		const departures = intBetween(random, 2, 4);
		for (let index = 0; index < departures; index += 1) {
			// Spread the departures over the day; the offset is drawn first so
			// that changing the frequency does not reshuffle the other slots.
			const hour = Math.min(22, 6 + index * Math.floor(16 / departures) + intBetween(random, 0, 2));
			const departure = new Date(start.getTime() + hour * 3_600_000 + intBetween(random, 0, 11) * 5 * 60_000);
			flights.push(makeFlight(store, from, to, departure, random));
		}
	}

	// Publish, then re-read through the registry. A flight id is deterministic, so
	// a rebuild after an eviction mints new objects for ids the registry may
	// still hold — and those registry objects are the ones a previous booking
	// mutated and the ones seat counts must come from. Returning the freshly built
	// objects instead would show a sold flight as empty again.
	for (const flight of flights) {
		register(store, flight);
	}
	return flights.map((flight) => store.flights.get(flight.id) ?? flight);
}

/**
 * The cached timetable for `dateIso`, building it on first use.
 *
 * Availability is refreshed from what this process knows, not from the ledger:
 * asking the database about every flight in a day would put several thousand
 * containment tests behind every search, and the answer barely moves. What the
 * count is used for is deciding what to show; what decides whether a seat can
 * actually be sold is {@link reserveSeats}, which does ask.
 */
async function dayFlights(dateIso: string): Promise<AfsFlight[]> {
	const store = getStore();
	let flights = store.days.get(dateIso);
	if (flights === undefined) {
		flights = buildDay(dateIso);
		store.days.set(dateIso, flights);
		store.dayOrder.push(dateIso);
		evictDays(store);
	}
	applyHeldSeats(store, flights);
	return flights;
}

/**
 * Show each flight's published count minus the seats taken by the live bookings
 * this process knows about.
 *
 * The count is derived, not maintained. `store.bookings` is every booking this
 * worker has made or read back from the ledger, each carrying its own status, so
 * counting the legs of the ones that are still `CONFIRMED` — and recounting after
 * every transition — cannot drift the way a running total does. A cancellation
 * performed here, a compensation that released a ticket, a booking read back
 * already cancelled: all three are the same reduction over the same map, and
 * there is nothing to unwind when one of them happens.
 *
 * It is a view, not the truth. A seat sold by a different worker since this one
 * last looked is not in it, and the page may therefore show a flight as available
 * that is full: the booking call refuses it with "No available seats on flight …",
 * which is the acceptable direction for that staleness to fail in. The reverse —
 * discounting seats nothing has claimed — would refuse bookings that are fine.
 */
function applyHeldSeats(store: AfsStore, flights: readonly AfsFlight[]): void {
	const held = heldInProcess(store);
	for (const flight of flights) {
		flight.availableSeats = Math.max(
			0,
			publishedSeats(store, flight) - (held.get(flight.id) ?? 0)
		);
	}
}

/* -------------------------------------------------------------------------- */
/* Seats and bookings                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve every id in an itinerary, in the order it was given.
 *
 * This is the stateless half of booking validation. An id is checked against the
 * schedule it names rather than against a registry of ids this process happened
 * to mint, so the answer does not depend on which worker ran the search — see the
 * note on determinism at the top of this file.
 *
 * @throws ApiError `404` when any id names no flight the schedule serves. The
 *   message is the upstream one, which is what the pages and the compensation
 *   path already report.
 */
async function legsFromIds(ids: readonly string[]): Promise<AfsFlight[]> {
	const legs = await Promise.all(ids.map(resolveFlight));
	if (legs.some((leg) => leg === undefined)) {
		throw notFound("One or more flights not found");
	}
	return legs as AfsFlight[];
}

/**
 * Claim one seat on every leg of `record`, or none of them.
 *
 * The flight object says how many seats it was published with; the question this
 * answers is how many are still free, and the booking ledger is what answers it.
 * This process's own count is not enough: a seat sold by another worker is not in
 * it, and two instances each decrementing their own copy would sell the last seat
 * twice.
 *
 * @returns the flights whose seats this call claimed, so a caller that cannot
 *   finish the booking can give them back.
 * @throws ApiError `400` when any leg has no seat left, before any is taken.
 */
async function reserveSeats(record: BookingRecord): Promise<AfsFlight[]> {
	const store = getStore();
	const legs = await legsFromIds(record.flightIds);

	for (const leg of legs) {
		if (leg.status !== "SCHEDULED") {
			throw badRequest(`No available seats on flight ${leg.id}`);
		}
	}

	/*
	 * The ledger's count is the truth; this process's own view can only add to
	 * it. A seat sold by another worker is in the ledger and not in `store`, and a
	 * cancelled booking can still be sitting in `store` as live because the
	 * cancellation happened elsewhere — so the two are compared per flight and the
	 * larger is what has to be assumed taken.
	 */
	const sold = await soldSeats(legs.map((leg) => leg.id));
	const mine = heldInProcess(store);

	const live = new Map<string, number>();
	for (const leg of legs) {
		const taken = Math.max(sold.get(leg.id) ?? 0, mine.get(leg.id) ?? 0);
		const available = publishedSeats(store, leg) - taken;
		if (available < 1) {
			throw badRequest(`No available seats on flight ${leg.id}`);
		}
		live.set(leg.id, available);
	}

	for (const leg of legs) {
		leg.availableSeats = (live.get(leg.id) ?? 1) - 1;
	}
	return legs;
}

/**
 * Seats taken by the live bookings this process knows about, by flight id.
 *
 * The same reduction {@link applyHeldSeats} renders with, exposed separately so
 * that a booking — which has to decide whether a seat can be sold — does not have
 * to walk a timetable to get it.
 */
function heldInProcess(store: AfsStore): Map<string, number> {
	const held = new Map<string, number>();
	for (const booking of store.bookings.values()) {
		if (booking.status === "CANCELLED") {
			continue;
		}
		for (const flightId of booking.flightIds) {
			held.set(flightId, (held.get(flightId) ?? 0) + 1);
		}
	}
	return held;
}

/**
 * How many seats `flight` was published with.
 *
 * The live count moves as seats are sold, so it cannot answer this — releasing a
 * seat by adding one to whatever the object currently holds would let a flight
 * sell more seats than it has. The published count is fixed the first time the
 * flight is built (see `makeFlight`), so this is a lookup with no fallback of any
 * consequence: the object in hand was built by that call.
 */
function publishedSeats(store: AfsStore, flight: AfsFlight): number {
	return store.capacity.get(flight.id) ?? flight.availableSeats;
}

/**
 * Give back the seats `flights` were holding.
 *
 * The count is recomputed, not incremented. By the time this runs the booking
 * has already been marked `CANCELLED`, so the reduction over `store.bookings`
 * that {@link applyHeldSeats} renders with excludes its legs — and re-rendering
 * the affected flights is the same statement of the rule that wrote them. Incrementing instead would add a seat to whatever number the object
 * happened to carry, which is not necessarily the one this booking took: a flight
 * whose availability was refreshed from another worker's sale would gain a seat
 * for a booking it never had.
 *
 * The flights are the ones the booking names, resolved rather than looked up, so
 * a flight this process never published cannot be silently skipped — and a
 * cancellation still succeeds, because giving a seat back is not something the
 * caller can be asked to retry.
 */
function releaseSeats(store: AfsStore, flights: readonly AfsFlight[]): void {
	if (flights.length === 0) {
		return;
	}
	applyHeldSeats(store, flights);
}

/** The AFS booking payload for a stored booking, with its legs resolved. */
function toBooking(booking: StoredBooking, legs: AfsFlight[]) {
	return {
		id: booking.id,
		firstName: booking.firstName,
		lastName: booking.lastName,
		email: booking.email,
		passportNumber: booking.passportNumber,
		// The upstream service derives both from the booking's uuid: the first six
		// characters are the passenger-facing reference, the rest the ticket number.
		bookingReference: booking.id.slice(0, 6).toUpperCase(),
		ticketNumber: booking.id.slice(26),
		status: booking.status,
		flights: legs,
		agencyId: "offline-agency",
	};
}

/** Resolve the legs of a booking whose ids may no longer be in the registry. */
async function legsOf(booking: StoredBooking): Promise<AfsFlight[]> {
	const legs = await Promise.all(booking.flightIds.map(resolveFlight));
	return legs.filter((flight): flight is AfsFlight => flight !== undefined);
}

/**
 * Report a booking whose ledger write failed, once per operation and error code.
 *
 * Deduplicated for the same reason the ledger's own reporting is: a database that
 * is down would otherwise produce one log line per booking attempt, and the
 * interesting fact is the first one.
 */
function reportLedgerFailure(store: AfsStore, operation: string, error: unknown): void {
	const reason = `${operation}:${
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code: unknown }).code)
			: "unknown"
	}`;
	if (store.ledgerFailures.has(reason)) {
		return;
	}
	store.ledgerFailures.add(reason);
	reportEvent("afs.offline.ledger-failure", {
		operation,
		detail: error instanceof Error ? error.message : String(error),
	});
}

/* -------------------------------------------------------------------------- */
/* Lookup: memory, ledger, and the local mirror                               */
/* -------------------------------------------------------------------------- */

/**
 * What a lookup found, and what may be done with it.
 *
 * `source` is the caller's licence to act: `ledger` and `legacy` are records the
 * provider can trust from any instance, `memory` is one only this worker knows
 * about, and `none` is the genuine 404.
 */
interface ResolvedBooking {
	booking: StoredBooking | undefined;
	source: "memory" | "ledger" | "legacy" | "none";
}

/**
 * Find a booking from wherever it can be found.
 *
 * In order:
 *
 * 1. Memory — this worker made the booking, or has already looked it up.
 * 2. The ledger — some other worker made it, and the durable row is what makes
 *    the booking resolvable from here at all.
 * 3. The caller's own `FlightReservation` row — a booking the provider cannot
 *    reconstruct, but which this system recorded. A row there means the booking
 *    is real and belongs to this system, so refusing to verify or cancel it
 *    would strand the passenger on a booking this application itself showed
 *    them; `verify` then reports the booking's own status and `cancel` completes
 *    locally. Without a database (or with one that has no such row) the answer is
 *    still the honest 404.
 *
 * A booking made on this instance but not persisted is returned from memory
 * rather than replaced by whatever the ledger says: the local copy is the one the
 * caller has already been handed.
 */
async function lookupBooking(store: AfsStore, id: string): Promise<ResolvedBooking> {
	const local = store.bookings.get(id);
	if (local !== undefined && !local.durable) {
		return { booking: local, source: "memory" };
	}

	try {
		const stored = await readBooking(id);
		if (stored !== undefined) {
			/*
			 * Cached under the same key as a booking made here, which is all the
			 * search overlay needs: `store.bookings` is the set of live bookings
			 * this worker knows about, and a booking it has just read back is one of
			 * them.
			 */
			const booking: StoredBooking = { ...stored, durable: true };
			store.bookings.set(id, booking);
			return { booking, source: "ledger" };
		}
	} catch (error) {
		reportLedgerFailure(store, "read", error);
	}

	if (local !== undefined) {
		return { booking: local, source: "memory" };
	}

	const legacy = await legacyBooking(store, id);
	if (legacy !== undefined) {
		store.bookings.set(id, legacy);
		return { booking: legacy, source: "legacy" };
	}

	return { booking: undefined, source: "none" };
}

/**
 * Look for `id` among the reservations the application itself recorded.
 *
 * This is the degraded path, not a substitute for the ledger: it can only answer
 * for bookings FlyNext has a row for, and it carries no legs. It exists so that
 * every booking in the deployment's own database stays verifiable and
 * cancellable, whichever store the provider itself happens to be reading from.
 * Together with the ledger it is what makes "the provider lost my booking" an
 * answerable state rather than a dead end.
 *
 * The id is the capability here. It is the value the application stores and shows
 * its owner, it is a uuid, and the reference the passenger sees is only its first
 * six characters — so a six-character reference still cannot reach this path. The
 * surname is not required on top of that, because a booking whose row is keyed by
 * this id is this booking, and demanding a second factor here would make the
 * compensation path fail for a booking whose passenger details never reached the
 * application at all.
 */
async function legacyBooking(
	store: AfsStore,
	id: string
): Promise<StoredBooking | undefined> {
	try {
		const row = await prisma.flightReservation.findUnique({
			where: { afsBookingId: id },
			select: {
				afsBookingId: true,
				status: true,
				createdAt: true,
				departure: true,
				arrival: true,
			},
		});
		if (row === null) {
			return undefined;
		}
		/*
		 * The legs are not recoverable from the row: it stores airport codes and
		 * timestamps, not flight ids, and those are not enough to re-derive an id
		 * for a timetable this process did not build. A booking found this way
		 * therefore reports no legs, which is honest — the pages read the
		 * booking's own stored JSON columns for display, and `verify` interprets
		 * an empty leg list as "status known, schedule unknown" rather than
		 * inventing one.
		 */
		return {
			id: row.afsBookingId,
			firstName: "",
			lastName: "",
			email: "",
			passportNumber: "",
			status: row.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
			flightIds: [],
			createdAt: row.createdAt,
			durable: false,
		};
	} catch {
		// No database, or no such model: nothing to fall back to.
		return undefined;
	}
}

/* -------------------------------------------------------------------------- */
/* Mode reporting                                                             */
/* -------------------------------------------------------------------------- */

/** Report the switch to the offline contract once per reason, not per request. */
export function noteOfflineMode(reason: string): void {
	const store = getStore();
	if (store.reportedModes.has(reason)) {
		return;
	}
	store.reportedModes.add(reason);
	reportEvent("afs.offline.active", { reason });
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Time a passenger needs between two legs of one booking.
 *
 * `GET /api/flights` only offers a pairing that leaves this much room, and
 * `POST /api/bookings` refuses one that does not — the same minimum the upstream
 * service enforces, so a search result here is always a bookable itinerary.
 */
const MINIMUM_LAYOVER_MS = 60 * 60_000;

/** `GET /api/cities` — the distinct cities an airport is in. */
export async function getCities(): Promise<AfsCity[]> {
	return AIRPORTS.map(({ city, country }) => ({ city, country }));
}

/** `GET /api/airports` — every airport the offline network knows. */
export async function getAirports(): Promise<AfsAirport[]> {
	return AIRPORTS.map((airport) => ({ ...airport }));
}

/** `GET /api/airlines` — every airline a leg can belong to. */
export async function getAirlines(): Promise<AfsAirline[]> {
	return AIRLINES.map((airline) => ({ ...airline }));
}

/**
 * Resolve a search term to airports.
 *
 * AFS accepts either an IATA code or a city name, case-insensitively, and a city
 * with more than one airport resolves to all of them — which is why this returns
 * a list rather than a single airport.
 */
function matchAirports(term: string): NetworkAirport[] {
	const wanted = term.trim().toLowerCase();
	return AIRPORTS.filter(
		(airport) =>
			airport.code.toLowerCase() === wanted ||
			airport.city.toLowerCase() === wanted
	);
}

/**
 * `GET /api/flights` — direct itineraries plus one-stop connections.
 *
 * Every group returned is bookable by {@link createBooking}, which is the
 * contract the results page relies on: a search result is an offer, and an offer
 * the booking endpoint would refuse is a dead end the passenger only discovers
 * after filling in their details. Concretely, a connecting group's legs always
 * satisfy `departure[1] - arrival[0] >= ` {@link MINIMUM_LAYOVER_MS}, either on
 * the searched date or by waiting for the next day's first departure.
 *
 * The error messages and their status codes are the upstream ones, so a client
 * that switched between the two back ends would behave identically.
 */
export async function searchFlights(
	params: AfsFlightSearchParams
): Promise<AfsFlightGroup[]> {
	const origin = (params.origin ?? "").trim();
	const destination = (params.destination ?? "").trim();
	const date = (params.date ?? "").trim();

	if (origin.length === 0 || destination.length === 0 || date.length === 0) {
		throw badRequest("Origin, destination, and date are required parameters");
	}
	if (parseIsoDay(date) === null) {
		throw badRequest("Date must use the YYYY-MM-DD format");
	}
	if (origin.toLowerCase() === destination.toLowerCase()) {
		throw badRequest("Origin and destination cannot be the same");
	}

	const origins = matchAirports(origin);
	const destinations = matchAirports(destination);
	if (origins.length === 0 || destinations.length === 0) {
		throw badRequest(
			"No airports found for the given origin or destination location"
		);
	}

	const day = await dayFlights(date);
	const destinationCodes = new Set(destinations.map((airport) => airport.code));

	const direct: AfsFlightGroup[] = [];
	const connections: AfsFlightGroup[] = [];

	/**
	 * A group is identified by the flights it contains, so this is what keeps one
	 * itinerary from being offered twice.
	 *
	 * A search term naming a city with several airports resolves to all of them,
	 * and a one-stop group can be reachable from more than one of them. Without
	 * this, the results page renders the same itinerary twice — and because the
	 * page keys its tick-boxes on the flight ids, ticking one box ticks both.
	 */
	const emitted = new Set<string>();
	const push = (target: AfsFlightGroup[], group: AfsFlightGroup): void => {
		const key = group.flights.map((flight) => flight.id).join("|");
		if (emitted.has(key)) {
			return;
		}
		emitted.add(key);
		target.push(group);
	};

	/**
	 * The first onward leg on the following day that a first leg can connect to.
	 *
	 * This is the airline answer to "the only same-day pairing misses the
	 * layover": the passenger waits for the next morning's departure. Reading the
	 * next day's timetable is what makes it a real flight rather than a longer
	 * version of the same near miss — the id resolves, the departure time is
	 * genuine, and a search today can be booked tomorrow.
	 *
	 * @returns the leg leaving `hub` for the destination at least
	 *   {@link MINIMUM_LAYOVER_MS} after `arrival`, or `undefined` when the next
	 *   day does not serve one either.
	 */
	const nextDayOnward = async (
		hub: string,
		arrival: number,
		dateIso: string
	): Promise<AfsFlight | undefined> => {
		const nextDay = new Date(`${dateIso}T00:00:00.000Z`).getTime() + 86_400_000;
		const tomorrow = await dayFlights(isoDay(new Date(nextDay)));
		let earliest: AfsFlight | undefined;
		let earliestDeparture = Number.POSITIVE_INFINITY;
		for (const leg of tomorrow) {
			if (leg.origin.code !== hub) {
				continue;
			}
			if (!destinationCodes.has(leg.destination.code)) {
				continue;
			}
			const departure = new Date(leg.departureTime).getTime();
			if (departure - arrival < MINIMUM_LAYOVER_MS) {
				continue;
			}
			if (departure < earliestDeparture) {
				earliest = leg;
				earliestDeparture = departure;
			}
		}
		return earliest;
	};

	for (const from of origins) {
		for (const flight of day) {
			if (flight.origin.code !== from.code) {
				continue;
			}

			if (destinationCodes.has(flight.destination.code)) {
				push(direct, toGroup([flight]));
				continue;
			}

			/*
			 * One stop: the first leg must land at one of our hubs, and a second
			 * leg must leave that hub for the destination with at least
			 * {@link MINIMUM_LAYOVER_MS} to connect.
			 *
			 * A pairing whose second leg leaves earlier — or too soon — is not a
			 * connection the booking endpoint would accept, so it is not offered.
			 * Handing one out anyway is what produced "Flights are not consecutive
			 * in sequence" at booking time, on exactly the cheap itineraries that
			 * sort to the top of the results page: a route like YYZ→PEK had no
			 * legal same-day pairing, so every itinerary it showed was unbuyable.
			 * A pairing that merely misses the layover is the same dead end one step
			 * later — the booking endpoint refuses it too — so the fallback below
			 * handles it rather than the tight version being offered.
			 */
			const arrival = new Date(flight.arrivalTime).getTime();
			const earliest = arrival + MINIMUM_LAYOVER_MS;
			let sameDay = 0;
			for (const leg of day) {
				if (leg.origin.code !== flight.destination.code) {
					continue;
				}
				if (!destinationCodes.has(leg.destination.code)) {
					continue;
				}
				if (new Date(leg.departureTime).getTime() < earliest) {
					continue;
				}
				sameDay += 1;
				push(connections, toGroup([flight, leg]));
			}

			/*
			 * Nothing to connect to today: wait for tomorrow's first departure.
			 * Only reached for a first leg that found no legal connection at all,
			 * so a route with a connection bank of its own is never padded with
			 * overnight waits — and because the next day always serves the hub,
			 * a route can no longer look unserved just because its one same-day
			 * pairing misses the layover by minutes.
			 */
			if (sameDay === 0) {
				const onwards = await nextDayOnward(flight.destination.code, arrival, date);
				if (onwards !== undefined) {
					push(connections, toGroup([flight, onwards]));
				}
			}
		}
	}

	/*
	 * Cheap itineraries first, which is the order a traveller expects and the
	 * order the results page renders verbatim.
	 */
	const byPrice = (left: AfsFlightGroup, right: AfsFlightGroup): number =>
		left.totalPrice - right.totalPrice;

	/*
	 * Direct flights first, then the one-stop itineraries — every one of which is
	 * a connection the booking endpoint accepts, whether it connects today or
	 * waits for tomorrow morning's departure. That is the property the results
	 * page depends on: what it renders with a "Book" button is what
	 * `POST /api/bookings` will sell.
	 */
	return [...direct.sort(byPrice), ...connections.sort(byPrice)];
}

/**
 * Wrap legs into the group envelope `GET /api/flights` returns.
 *
 * `totalDuration` is the legs' combined block time — the time actually spent
 * in the air — which is the same quantity `GET /api/flights/search` derives from
 * the legs it returns and the same one the results page labels "Total Duration".
 * The layover is deliberately excluded: it is shown separately, per connection,
 * and folding it in would make the total disagree with the sum of the leg
 * durations listed underneath it.
 *
 * `totalPrice` is computed here even though the results page recomputes it: the
 * field is part of the contract, and a non-HTTP consumer has no second chance to
 * derive it.
 */
function toGroup(flights: AfsFlight[]): AfsFlightGroup {
	const totalPrice =
		Math.round(flights.reduce((sum, flight) => sum + flight.price, 0) * 100) / 100;

	return {
		flights,
		legs: flights.length,
		totalPrice,
		totalDuration: flights.reduce(
			(sum, flight) =>
				typeof flight.durationMinutes === "number"
					? sum + flight.durationMinutes
					: sum,
			0
		),
	};
}

/**
 * `POST /api/bookings` — buy the seats and keep a reference.
 *
 * The validation mirrors the upstream handler: the ids must name flights the
 * schedule serves, every leg must have a seat, and legs must be in departure
 * order and separated by a real layover. Skipping it would let the offline
 * implementation accept a booking the real service rejects, and the compensation
 * path in `lib/reservations.ts` exists precisely because upstream rejections
 * happen.
 *
 * The ids are resolved with {@link legsFromIds}, not looked up in this process's
 * registry: the booking is a second request, and on a serverless host it is
 * usually a different process from the one that answered the search.
 */
export async function createBooking(
	bookingData: AfsCreateBookingRequest
): Promise<AfsBooking> {
	const store = getStore();
	const { email, firstName, lastName, passportNumber } = bookingData;
	const flightIds = Array.isArray(bookingData.flightIds) ? bookingData.flightIds : [];

	for (const [field, value] of Object.entries({
		firstName,
		lastName,
		email,
		passportNumber,
	})) {
		if (typeof value !== "string" || value.trim().length === 0) {
			throw badRequest(`Missing or invalid ${field}`);
		}
	}
	if (passportNumber.trim().length < 9) {
		throw badRequest("Passport number must be 9 digits long");
	}
	if (flightIds.length === 0) {
		throw badRequest("Missing or invalid flight IDs");
	}

	const legs = await legsFromIds(flightIds);

	/*
	 * Every leg must be flyable in the order it was given, with a real layover
	 * before the next one: a leg that departs before the previous one lands is not
	 * a connection at all, and a leg that leaves with less than
	 * {@link MINIMUM_LAYOVER_MS} to spare cannot be connected to. The two cases are
	 * reported separately because the caller's mistake is different — the first is
	 * an itinerary that does not exist, the second is a real itinerary booked as
	 * though it were one.
	 *
	 * This is the same rule `GET /api/flights` applies when it builds a one-stop
	 * group, and the reason its results are always acceptable here.
	 */
	for (let index = 1; index < legs.length; index += 1) {
		const previous = legs[index - 1]!;
		const leg = legs[index]!;
		const arrival = new Date(previous.arrivalTime).getTime();
		const departure = new Date(leg.departureTime).getTime();
		if (departure < arrival) {
			throw badRequest("Flights are not consecutive in sequence");
		}
		if (departure - arrival < MINIMUM_LAYOVER_MS) {
			throw badRequest(
				`Flights ${previous.id} and ${leg.id} are less than an hour apart`
			);
		}
	}

	const id = bookingId();
	if (store.bookings.get(id)?.durable === true) {
		/*
		 * Unreachable with a real uuid, and never acceptable: overwriting the map
		 * entry would orphan the first booking and let a later cancellation release
		 * its seats a second time. Refusing to book is the only safe answer.
		 *
		 * Only a durable booking is checked here, because only one of those
		 * shadows a row: an in-memory booking that failed to persist is not a
		 * collision, and the ledger's own primary key is what rejects a repeat of
		 * one that did.
		 */
		throw badGateway(
			`Booking failed: booking id ${id} is already in use, please retry`
		);
	}

	// Seats are counted and claimed only after the itinerary has been validated and
	// an id reserved, so a rejection cannot leave a seat consumed by a booking that
	// never existed.
	const record: BookingRecord = {
		id,
		firstName: firstName.trim(),
		lastName: lastName.trim(),
		email: email.trim(),
		passportNumber: passportNumber.trim(),
		status: "CONFIRMED",
		flightIds: legs.map((leg) => leg.id),
		createdAt: new Date(),
	};
	const claimed = await reserveSeats(record);

	const durable = await writeBooking(record);
	if (!durable && isDurable()) {
		/*
		 * The ledger is configured but would not take the booking. Answering
		 * "confirmed" would hand back a ticket that no other instance can verify or
		 * cancel — the exact failure this replaced — so the seats are given back and
		 * the caller is told the booking failed. `isDurable()` is what distinguishes
		 * this from a deployment with no database at all, where memory is the
		 * documented behaviour rather than a fault.
		 */
		releaseSeats(store, claimed);
		throw badGateway(
			"Booking failed: the booking could not be recorded, please retry"
		);
	}

	const booking: StoredBooking = { ...record, durable };
	store.bookings.set(id, booking);

	return toBooking(booking, legs);
}

/**
 * `GET /api/bookings/retrieve` — look a booking up by surname and reference.
 *
 * The booking is found by id (see {@link lookupBooking}), which is what makes a
 * booking made on one instance retrievable from another.
 */
export async function retrieveBooking(
	lastName: string,
	bookingReference: string
): Promise<AfsRetrievedBooking> {
	const store = getStore();
	if (!lastName || !bookingReference) {
		throw badRequest("Missing lastName or bookingReference");
	}
	const { booking } = await lookupBooking(store, bookingReference);
	if (booking === undefined) {
		throw notFound("Booking not found");
	}
	return {
		bookingReference: booking.id.slice(0, 6).toUpperCase(),
		status: booking.status,
		flights: await legsOf(booking),
		createdAt: booking.createdAt?.toISOString() ?? new Date().toISOString(),
	};
}

/**
 * `POST /api/bookings/cancel` — release the seats and mark the booking cancelled.
 *
 * Idempotent across instances, not merely within one: the transition is the stored
 * status, so a second cancellation finds it already `CANCELLED` and releases
 * nothing — wherever it is served from.
 */
export async function cancelBooking(
	bookingReference: string,
	lastName: string
): Promise<AfsBookingStatus> {
	const store = getStore();
	if (!lastName || !bookingReference) {
		throw badRequest("Missing lastName or bookingReference");
	}
	const { booking, source } = await lookupBooking(store, bookingReference);
	if (booking === undefined) {
		throw notFound("Booking not found");
	}

	if (booking.status !== "CANCELLED") {
		booking.status = "CANCELLED";

		/*
		 * The durable status is what makes the release happen once. It is written
		 * first: if it fails, this process still releases its own seats, and the
		 * booking stays cancellable so another attempt can finish the job. The
		 * reverse order would leave seats sold against a booking nothing can cancel.
		 */
		if (source === "ledger") {
			const stored = await setStatus(booking.id, "CANCELLED");
			if (!stored) {
				reportLedgerFailure(store, "cancel", new Error("status not persisted"));
			}
		}
		if (booking.flightIds.length > 0) {
			releaseSeats(store, await legsOf(booking));
		}
	}

	return { status: booking.status, flights: await legsOf(booking) };
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/** Counts describing the store, for a health check or a debugging session. */
export function offlineStats(): {
	airports: number;
	airlines: number;
	cachedDays: number;
	registeredFlights: number;
	bookings: number;
} {
	const store = getStore();
	return {
		airports: AIRPORTS.length,
		airlines: AIRLINES.length,
		cachedDays: store.days.size,
		registeredFlights: store.flights.size,
		bookings: store.bookings.size,
	};
}
