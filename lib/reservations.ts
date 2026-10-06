/**
 * Shared reservation lifecycle logic.
 *
 * Four routes cancel hotel reservations and three cancel flight reservations, so
 * the availability accounting, the idempotency guards and the itinerary price
 * adjustments for a stay all live here rather than being repeated — and, in the
 * process, contradicted — in each copy. A stay is released exactly the same way
 * wherever the cancellation is triggered.
 *
 * The flight side additionally owns the compensating write described on
 * {@link createFlightReservation}: AFS is the system of record for a ticket, and
 * the local row is a mirror of it.
 */

import type { Prisma } from "@prisma/client";
import { cancelFlight, createBooking } from "./afs-client";
import { type ApiError, badGateway } from "./api/errors";
import { reportAlert, reportEvent } from "./api/events";
import { eachNight } from "./api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "./prisma";
import type {
	AfsBooking,
	AfsCreateBookingRequest,
	AfsFlight,
	FlightLegDto,
	FlightLegJson,
	FlightSegmentDto,
	FlightSegmentJson,
} from "@/types";

/** A Prisma client bound to an open transaction. */
type TransactionClient = Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/* Flight reservation JSON columns                                            */
/* -------------------------------------------------------------------------- */

/** Sentinel the booking pages test against for "this leg does not exist". */
const ABSENT = " ";

/**
 * Narrow a `departure` / `arrival` JSON column into the wire shape.
 *
 * Both booking-history endpoints must keep emitting the single-space sentinel
 * `" "` for an absent value — `formatDate()` renders it as `"N/A"` and the
 * return-leg blocks are gated on `!== " "`. Emitting `null` or `""` instead would
 * render "Invalid Date".
 *
 * `goLegs` / `returnLegs` are the flights each direction is made of. A row
 * written before they were recorded has none, and an absent list becomes an empty
 * one so a page never has to test for `undefined`; the direction can still be
 * rendered from the four summary values, just without its connections.
 */
export function toFlightLegDto(value: Prisma.JsonValue): FlightLegDto {
	const record =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, Prisma.JsonValue>)
			: {};
	const read = (key: string): string => {
		const field = record[key];
		return typeof field === "string" && field.length > 0 ? field : ABSENT;
	};
	return {
		goDate: read("goDate"),
		goAirport: read("goAirport"),
		returnDate: read("returnDate"),
		returnAirport: read("returnAirport"),
		goLegs: readSegments(record["goLegs"]),
		returnLegs: readSegments(record["returnLegs"]),
	};
}

/** Narrow one direction's stored leg list, dropping anything that is not a leg. */
function readSegments(value: Prisma.JsonValue | undefined): FlightSegmentDto[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const segments: FlightSegmentDto[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			continue;
		}
		const record = entry as Record<string, Prisma.JsonValue>;
		const read = (key: string): string => {
			const field = record[key];
			return typeof field === "string" && field.length > 0 ? field : ABSENT;
		};
		segments.push({
			from: read("from"),
			to: read("to"),
			departDate: read("departDate"),
			arriveDate: read("arriveDate"),
		});
	}
	return segments;
}

/* -------------------------------------------------------------------------- */
/* Hotel availability                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Mark a hotel reservation cancelled, exactly once.
 *
 * The conditional `updateMany` is what makes this idempotent: a second call finds
 * no non-cancelled row and reports `false`, so the caller does not release the
 * same nights twice.
 *
 * @returns `true` when this call performed the transition.
 */
export async function claimHotelCancellation(
	tx: TransactionClient,
	reservationId: number
): Promise<boolean> {
	const claimed = await tx.hotelReservation.updateMany({
		where: { id: reservationId, status: { not: "CANCELLED" } },
		data: { status: "CANCELLED" },
	});
	return claimed.count > 0;
}

/**
 * Give every night of a stay back to the room type.
 *
 * This is the exact inverse of the booking flow, which decrements one
 * `RoomAvailabilityRecord` per night. Incrementing the room type's aggregate
 * `currentAvailability` instead would leave per-day availability falling
 * monotonically with the booking calendar drifting away from the truth, because
 * every read and every booking compares per-night rows.
 */
export async function releaseStayAvailability(
	tx: TransactionClient,
	roomTypeId: number | null,
	checkIn: Date,
	checkOut: Date
): Promise<void> {
	if (roomTypeId === null) {
		return;
	}
	for (const date of eachNight(checkIn, checkOut)) {
		await tx.roomAvailabilityRecord.updateMany({
			where: { roomTypeId, date },
			data: { availability: { increment: 1 } },
		});
	}
}

/**
 * Cancel a hotel reservation and unwind everything attached to it.
 *
 * Runs in one transaction: the status transition, the availability release and
 * the itinerary price adjustment either all apply or none do. Updating the status
 * first and then bailing out with a `404` when the room type is gone would leave
 * the booking cancelled but the itinerary price untouched, which no later request
 * can repair.
 *
 * @returns `true` when the reservation moved to `CANCELLED`.
 */
export async function cancelHotelReservation(
	reservationId: number
): Promise<boolean> {
	return prisma.$transaction(async (tx) => {
		const reservation = await tx.hotelReservation.findUnique({
			where: { id: reservationId },
			select: {
				id: true,
				roomTypeId: true,
				checkIn: true,
				checkOut: true,
				price: true,
				itineraryId: true,
			},
		});
		if (reservation === null) {
			return false;
		}

		const claimed = await claimHotelCancellation(tx, reservation.id);
		if (!claimed) {
			return false;
		}

		await releaseStayAvailability(
			tx,
			reservation.roomTypeId,
			reservation.checkIn,
			reservation.checkOut
		);

		await adjustItineraryTotal(tx, reservation.itineraryId, reservation.price);

		return true;
	}, DEFAULT_TRANSACTION_OPTIONS);
}

/**
 * Apply a price change to the itinerary a reservation belongs to.
 *
 * `updateMany` rather than `update`: a reservation can outlive its itinerary,
 * because deleting an itinerary nulls the child's foreign key while a copy of the
 * row loaded moments before still carries the stale `itineraryId`. `update` would
 * raise `P2025` and roll back the whole cancellation — for a flight, after the
 * airline had already cancelled the ticket, leaving a booking that is cancelled
 * upstream, still `CONFIRMED` locally, and impossible to cancel again because
 * every retry hits the same error. Matching zero rows instead lets the status
 * transition and the availability release commit.
 */
async function adjustItineraryTotal(
	tx: TransactionClient,
	itineraryId: number | null,
	amount: number
): Promise<void> {
	if (itineraryId === null) {
		return;
	}
	await tx.itinerary.updateMany({
		where: { id: itineraryId },
		data: { totalPrice: { decrement: amount } },
	});
}

/* -------------------------------------------------------------------------- */
/* Flight booking                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Project an AFS airport onto the JSON-column shape.
 *
 * Only the IATA code is stored; the booking history pages render `goAirport` and
 * `returnAirport` as codes.
 */
function airportCode(airport: AfsFlight["origin"]): string | null {
	return typeof airport.code === "string" && airport.code.length > 0
		? airport.code
		: null;
}

/** ISO-8601 timestamp, or `null` when the source value is unusable. */
function isoOrNull(value: string | undefined): string | null {
	if (value === undefined) {
		return null;
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * A booked itinerary, as the two directions a traveller actually flies.
 *
 * The distinction matters because a direction is not a leg. One search result
 * — and therefore one half of a trip — is a journey of one or two legs:
 * `YYZ→HKG→CAN` is a single outbound direction from Toronto to Guangzhou that
 * happens to change planes in Hong Kong. Reading the first two legs of a booking
 * as "outbound" and "return" is what made a one-way ticket with a connection
 * render an "Outbound" card and a "Return" card that were really leg one and leg
 * two of the same journey, and made a round trip show its outbound twice.
 */
export interface FlightDirections {
	/** The legs flown away from the trip's origin, in departure order. */
	outbound: readonly AfsFlight[];
	/** The legs flown home, or `undefined` for a one-way booking. */
	inbound: readonly AfsFlight[] | undefined;
}

/**
 * Split a booked itinerary into the two directions it is made of.
 *
 * `returnLegCount` is how many of the trailing legs are the flight home, as
 * declared by the caller that assembled the itinerary — see
 * `app/api/flights/book/route.ts`. `0` declares a one-way booking, a count that
 * splits the itinerary is used as given, and `undefined` (or a count that would
 * leave one of the halves empty) is derived below. The route answers `400` for a
 * count that is not a split of the ids it was sent, so the fallback here only
 * ever covers a direct caller.
 *
 * Without it, the split is derived, because the provider's booking response is a
 * flat list of legs with nothing marking where the return begins. Two facts
 * about an itinerary are enough for every booking this application makes:
 *
 * 1. A round trip is the only itinerary that lands back where it started —
 *    `POST /api/flights/book` buys one ticket per journey, and a one-way ticket
 *    that returned to its origin would be a round trip with a different name.
 * 2. Within a round trip, the stay at the destination is the longest wait
 *    between two consecutive legs by a wide margin: connecting legs are held to
 *    the provider's one-hour minimum, while the return has to leave on a later
 *    date than the outbound.
 *
 * When neither holds — a one-way with a connection, or synthetic legs whose
 * times say nothing — the itinerary is one direction, and halving it is the
 * closest a reader can get to the two equal halves a round trip is booked as.
 * The declared count is what the application itself relies on; this derivation
 * exists so that a caller holding only `flightIds` is still recorded sensibly.
 */
export function splitFlightDirections(
	legs: readonly AfsFlight[],
	returnLegCount?: number
): FlightDirections {
	if (legs.length === 0) {
		return { outbound: [], inbound: undefined };
	}

	if (returnLegCount !== undefined) {
		const count = Math.trunc(returnLegCount);
		// A declared "no return half" is taken at its word: a one-way ticket that
		// happens to land where it began is still one direction.
		if (count === 0) {
			return { outbound: legs, inbound: undefined };
		}
		if (count > 0 && count < legs.length) {
			const outbound = legs.slice(0, legs.length - count);
			return { outbound, inbound: legs.slice(outbound.length) };
		}
	}

	const turnaround = turnaroundIndex(legs);
	if (turnaround === null) {
		return { outbound: legs, inbound: undefined };
	}
	return {
		outbound: legs.slice(0, turnaround + 1),
		inbound: legs.slice(turnaround + 1),
	};
}

/** The IATA code of one end of a leg, or `undefined` when it carries none. */
function legAirport(
	flight: AfsFlight,
	end: "origin" | "destination"
): string | undefined {
	const code = flight[end]?.code;
	return typeof code === "string" && code.length > 0 ? code : undefined;
}

/** How long a traveller waits between two consecutive legs, in milliseconds. */
function waitBetween(arrived: AfsFlight, departing: AfsFlight): number | null {
	const landed = Date.parse(arrived.arrivalTime);
	const leaves = Date.parse(departing.departureTime);
	if (Number.isNaN(landed) || Number.isNaN(leaves)) {
		return null;
	}
	return leaves - landed;
}

/**
 * The index of the last leg flown away from home, or `null` when the itinerary
 * never comes back to where it started.
 *
 * The stay is the longest wait between two consecutive legs, and it has to be
 * the only longest one to be trusted: two waits of the same length mean the
 * times do not say which one is the stay, and the honest answer is then to
 * halve the itinerary — the shape a round trip booked through the search page
 * has, one direction after the other.
 */
function turnaroundIndex(legs: readonly AfsFlight[]): number | null {
	if (legs.length < 2) {
		return null;
	}
	const origin = legAirport(legs[0]!, "origin");
	const home = legAirport(legs[legs.length - 1]!, "destination");
	if (origin === undefined || home === undefined || origin !== home) {
		return null;
	}

	const waits = legs
		.slice(0, -1)
		.map((leg, index) => waitBetween(leg, legs[index + 1]!));
	const known = waits.filter((wait): wait is number => wait !== null);
	const longest = known.length === 0 ? null : Math.max(...known);
	const stays = waits
		.map((wait, index) => (wait !== null && wait === longest ? index : -1))
		.filter((index) => index >= 0);

	if (stays.length === 1) {
		return stays[0]!;
	}
	return Math.ceil(legs.length / 2) - 1;
}

/**
 * Project a booked direction onto the JSON-column shape.
 *
 * `departure` records where each direction began — its first leg's departure
 * time and origin — and `arrival` records where each direction ended: its last
 * leg's arrival time and destination. A direction is a whole journey rather than
 * a single hop, so `YYZ→HKG→CAN` is stored with `goAirport: "YYZ"` on the
 * `departure` column and `goAirport: "CAN"` on the `arrival` one: the connection
 * is part of the outbound direction, not a direction of its own.
 *
 * Those four values say nothing about how the direction was flown, though, and a
 * traveller changing planes in Hong Kong needs to see it. `goLegs` / `returnLegs`
 * carry every flight of each direction in order, which is where the transfer
 * airports and each flight's own times come from.
 *
 * A one-way booking leaves both return keys `null`, which is what
 * `flightDirections` in `app/lib/booking-display.ts` tests to decide whether a
 * second card is rendered at all.
 */
export function buildFlightLegs(directions: FlightDirections): {
	departure: FlightLegJson;
	arrival: FlightLegJson;
} {
	return buildFlightLegsFromSegments({
		outbound: directions.outbound.map(buildSegment),
		inbound: directions.inbound?.map(buildSegment),
	});
}

/**
 * The same projection from flights that are already in the stored shape.
 *
 * `scripts/repair-flight-directions.ts` rebuilds rows from legs it recovers as
 * segments — from the provider's ledger, or from the summary values a row in the
 * legacy record shape carries — and it has to produce exactly the columns a new
 * booking would, not a second interpretation of them.
 */
export function buildFlightLegsFromSegments(directions: {
	outbound: readonly FlightSegmentJson[];
	inbound?: readonly FlightSegmentJson[] | undefined;
}): { departure: FlightLegJson; arrival: FlightLegJson } {
	const outboundStart = directions.outbound[0];
	const outboundEnd = directions.outbound[directions.outbound.length - 1];
	const inbound = directions.inbound ?? [];
	const inboundStart = inbound[0];
	const inboundEnd = inbound[inbound.length - 1];

	/*
	 * The legs go into both columns on purpose. The pair is read as two views of
	 * one itinerary, and a reader holding only one of them should still see the
	 * connections; both lists are copies of the same arrays, so they cannot drift
	 * apart.
	 */
	const goLegs = directions.outbound.map((segment) => ({ ...segment }));
	const returnLegs = inbound.map((segment) => ({ ...segment }));

	return {
		departure: {
			goDate: outboundStart?.departDate ?? null,
			goAirport: outboundStart?.from ?? null,
			returnDate: inboundStart?.departDate ?? null,
			returnAirport: inboundStart?.from ?? null,
			goLegs,
			returnLegs,
		},
		arrival: {
			goDate: outboundEnd?.arriveDate ?? null,
			goAirport: outboundEnd?.to ?? null,
			returnDate: inboundEnd?.arriveDate ?? null,
			returnAirport: inboundEnd?.to ?? null,
			goLegs,
			returnLegs,
		},
	};
}

/** Project one flown leg onto the stored segment shape. */
export function buildSegment(flight: AfsFlight): FlightSegmentJson {
	return {
		from: airportCode(flight.origin),
		to: airportCode(flight.destination),
		departDate: isoOrNull(flight.departureTime),
		arriveDate: isoOrNull(flight.arrivalTime),
	};
}

/** Total of the leg prices, ignoring anything that is not a finite number. */
export function totalFlightPrice(flights: readonly AfsFlight[]): number {
	return flights.reduce(
		(sum, flight) => sum + (Number.isFinite(flight.price) ? flight.price : 0),
		0
	);
}

/** Signature of the AFS booking call, injectable so tests can drive failures. */
export type CreateBookingCall = (
	payload: AfsCreateBookingRequest
) => Promise<AfsBooking>;

/** Signature of the AFS cancellation call, injectable alongside it. */
export type CancelFlightCall = (
	bookingReference: string,
	lastName: string
) => Promise<{ status: string }>;

/**
 * The key AFS authorises retrieval and cancellation with.
 *
 * This is the booking's own id, not the passenger-facing
 * `bookingReference`. The reference is only the first six characters of the id,
 * and it is not a key AFS accepts: `GET /api/bookings/retrieve` and
 * `POST /api/bookings/cancel` resolve a booking by its id. Storing the short
 * reference produced a local row that verified and cancelled as
 * "Booking not found", because the identifier written here is exactly what
 * {@link cancelFlightReservation} sends back upstream.
 *
 * Falls back to `bookingReference` for a provider that reports no id, which
 * keeps a response without `id` bookable rather than unresolvable.
 */
export function afsBookingKey(booking: {
	id?: string;
	bookingReference: string;
}): string {
	return typeof booking.id === "string" && booking.id.length > 0
		? booking.id
		: booking.bookingReference;
}

/**
 * Collaborators {@link createFlightReservation} talks to, overridable in tests,
 * plus the one thing about an itinerary the provider's response does not say.
 */
export interface FlightBookingOptions {
	createBooking?: CreateBookingCall;
	cancelFlight?: CancelFlightCall;
	/**
	 * How many of the trailing `payload.flightIds` are the flight home, as
	 * declared by whoever assembled the itinerary — see
	 * {@link splitFlightDirections}. `0` records a one-way booking and
	 * `undefined` leaves the split to be derived.
	 */
	returnLegCount?: number;
}

/**
 * Book with AFS and mirror the result locally.
 *
 * AFS is the system of record: it issues the ticket, and the local
 * `FlightReservation` row exists so that booking history, cancellation and the
 * itinerary price have something to point at. That ordering creates one failure
 * mode worth handling explicitly — the ticket exists and the local row does not —
 * which is what the compensation below is for.
 *
 * The steps are:
 *
 * 1. Validate the AFS response. An empty leg list means AFS accepted the booking
 *    but returned nothing usable, so it is compensated the same way a database
 *    failure is: the alternative is an unusable ticket the passenger cannot see.
 * 2. Write the local row, keyed by {@link afsBookingKey} — the booking's AFS id.
 *    The legs are first grouped into the directions flown, because the provider
 *    returns one flat list whether the booking is a one-way with a connection or
 *    a round trip; see {@link splitFlightDirections}.
 * 3. If step 2 fails, ask AFS to cancel the booking just created, so the two
 *    systems agree again.
 *
 * Compensation is best effort by nature: it is a second call to the dependency
 * that just failed. When it does not succeed the booking is orphaned — paid for
 * and ticketed upstream, invisible locally — and that is a state no amount of
 * retrying inside this request can repair. It is therefore recorded as an alert
 * carrying every identifier needed to reconcile it by hand
 * (`flight.booking.orphaned`), and the caller receives `502` rather than a
 * success for a booking the application cannot show them.
 *
 * @throws ApiError `502` when AFS fails, returns no legs, or the local write could
 *   not be completed.
 */
export async function createFlightReservation(
	payload: AfsCreateBookingRequest,
	userId: number,
	options: FlightBookingOptions = {}
): Promise<{ booking: AfsBooking; reservationId: number }> {
	const book = options.createBooking ?? createBooking;
	const compensate = options.cancelFlight ?? cancelFlight;

	// Step 1: the upstream booking. A failure here leaves nothing to unwind.
	const booking = await book(payload);

	if (booking.flights.length === 0) {
		throw await releaseOrReport(
			compensate,
			afsBookingKey(booking),
			payload.lastName,
			"the airline returned no flight legs"
		);
	}

	const legs = buildFlightLegs(
		splitFlightDirections(booking.flights, options.returnLegCount)
	);

	// Step 2: the local mirror.
	try {
		const reservation = await prisma.flightReservation.create({
			data: {
				afsBookingId: afsBookingKey(booking),
				userId,
				departure: legs.departure,
				arrival: legs.arrival,
				price: totalFlightPrice(booking.flights),
				status: "CONFIRMED",
			},
			select: { id: true },
		});
		return { booking, reservationId: reservation.id };
	} catch (error) {
		// Step 3: the ticket exists, the local row does not. Cancel the ticket.
		throw await releaseOrReport(
			compensate,
			afsBookingKey(booking),
			payload.lastName,
			error instanceof Error ? error.message : "unknown local write failure"
		);
	}
}

/**
 * Undo an upstream booking that cannot be represented locally.
 *
 * Never throws: the caller is already on a failing path, and it needs to know
 * whether the ticket was released so it can choose the message and the status.
 *
 * @param bookingKey the AFS booking id to release, as returned by
 *   {@link afsBookingKey} — the same value stored on the local row.
 * @returns the outcome of the release attempt, and the reason when it did not
 *   succeed.
 */
async function releaseUpstreamBooking(
	compensate: CancelFlightCall,
	bookingKey: string,
	lastName: string
): Promise<{ released: boolean; reason: string }> {
	try {
		const cancellation = await compensate(bookingKey, lastName);
		if (cancellation.status === "CANCELLED") {
			return { released: true, reason: "cancelled" };
		}
		return {
			released: false,
			reason: `the airline did not confirm cancellation (status "${cancellation.status}")`,
		};
	} catch (error) {
		return {
			released: false,
			reason: error instanceof Error ? error.message : "the cancellation call failed",
		};
	}
}

/**
 * Release a booking that could not be mirrored locally, then describe the outcome.
 *
 * A released ticket leaves the two systems consistent again and only needs a
 * record; one that could not be released is an orphan — ticketed and paid for
 * upstream, invisible locally — which requires an operator and is recorded as an
 * alert with every identifier needed to reconcile it.
 *
 * @param bookingKey the AFS booking id to release, as returned by
 *   {@link afsBookingKey}. It is logged under the `bookingReference` field, which
 *   is the name an operator reconciling by hand will look for.
 * @returns the `ApiError` the caller should throw.
 */
async function releaseOrReport(
	compensate: CancelFlightCall,
	bookingKey: string,
	lastName: string,
	cause: string
): Promise<ApiError> {
	const { released, reason } = await releaseUpstreamBooking(
		compensate,
		bookingKey,
		lastName
	);

	if (released) {
		reportEvent("flight.booking.compensated", {
			bookingReference: bookingKey,
			cause,
		});
		return badGateway(
			"Booking failed and the ticket has been released: the reservation could not be recorded"
		);
	}

	reportAlert("flight.booking.orphaned", {
		bookingReference: bookingKey,
		cause,
		reason,
	});
	return badGateway(
		"Booking status is unresolved: the booking could not be released"
	);
}

/* -------------------------------------------------------------------------- */
/* Flight cancellation                                                        */
/* -------------------------------------------------------------------------- */

/** Outcome of a flight cancellation request. */
export type FlightCancellationOutcome = "cancelled" | "already-cancelled";

/**
 * Cancel a flight reservation through AFS and mirror the result locally.
 *
 * The upstream call happens outside the database transaction on purpose: a
 * third-party HTTP request must never hold a database transaction open.
 *
 * @param reservationId local `FlightReservation.id`
 * @param passengerLastName surname AFS requires to authorise the cancellation
 *
 * @throws ApiError `502` when AFS refuses or does not confirm the cancellation.
 */
export async function cancelFlightReservation(
	reservationId: number,
	passengerLastName: string
): Promise<FlightCancellationOutcome> {
	const reservation = await prisma.flightReservation.findUnique({
		where: { id: reservationId },
		select: {
			id: true,
			afsBookingId: true,
			price: true,
			status: true,
			itineraryId: true,
		},
	});
	if (reservation === null) {
		return "already-cancelled";
	}
	if (reservation.status !== "CONFIRMED") {
		return "already-cancelled";
	}

	const cancellation = await cancelFlight(
		reservation.afsBookingId,
		passengerLastName
	);
	if (cancellation.status !== "CANCELLED") {
		throw badGateway("Flight booking cancellation failed");
	}

	await prisma.$transaction(async (tx) => {
		// Idempotent: only the call that flips CONFIRMED -> CANCELLED adjusts the price.
		const claimed = await tx.flightReservation.updateMany({
			where: { id: reservation.id, status: { not: "CANCELLED" } },
			data: { status: "CANCELLED" },
		});
		if (claimed.count === 0) {
			return;
		}
		await adjustItineraryTotal(tx, reservation.itineraryId, reservation.price);
	}, DEFAULT_TRANSACTION_OPTIONS);

	return "cancelled";
}
