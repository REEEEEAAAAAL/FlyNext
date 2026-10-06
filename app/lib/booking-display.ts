"use client";

/**
 * Presentation helpers for a flight reservation's identifiers and legs.
 *
 * ## Two identifiers, two jobs
 *
 * A `FlightReservation` row carries `afsBookingId`, which for the provider this
 * app talks to is a 36-character UUID. That value is the key — it is what
 * `retrieve` and `cancel` authorise with — and it is stored in full
 * because a truncated key cannot be sent back upstream.
 *
 * The passenger-facing booking reference is the first six characters of that
 * id, upper-cased, which is exactly how the provider mints it
 * (`bookingReference: booking.id.slice(0, 6).toUpperCase()` in
 * `lib/afs/offline.ts`). It is short enough to read aloud, to type, and to fit in
 * a card heading — which is what a "Booking #" label is for.
 *
 * The booking pages therefore render {@link bookingReference} as the heading and
 * keep the full id in a secondary "Full reference" line for support and for
 * matching against the provider's own records.
 *
 * ## Outbound and return
 *
 * A booking stores its itinerary in two JSON columns: `departure` (the outbound
 * direction's departure time and origin airport) and `arrival` (the outbound
 * direction's arrival time and destination airport). A round trip puts the way
 * home in those same two columns under `returnDate` / `returnAirport`, and a
 * one-way booking leaves both of those as the single-space sentinel.
 *
 * The unit stored is a direction, not a leg. A journey with a connection —
 * `YYZ→HKG→CAN` — is one outbound direction, recorded as leaving Toronto and
 * landing in Guangzhou; the change of planes in Hong Kong is a detail of how it
 * is flown, not a second direction. So "outbound" and "return" are whole
 * journeys, and {@link flightDirections} turns them back into the two cards the
 * booking pages render — returning a one-element array for a one-way booking, so
 * no page has to render an empty "Return" placeholder, and a connecting one-way
 * cannot be mistaken for a round trip.
 *
 * ## Connections
 *
 * A summary of "YYZ to CAN" is correct for a connecting ticket but not useful:
 * the traveller wants to know where they change planes. Each direction therefore
 * also carries the flights it is made of (`goLegs` / `returnLegs`), and
 * {@link FlightDirection.stops} names the airports in between — `["HKG"]` for the
 * journey above — which the cards render as a "Via" line.
 */

import type { FlightLegDto, FlightSegmentDto } from "@/types";

/** The sentinel both booking endpoints emit for an absent leg value. */
const ABSENT = " ";

/** True when a leg field carries a real value rather than the sentinel. */
export function hasLegValue(value: string | null | undefined): boolean {
	return (
		value !== null &&
		value !== undefined &&
		value.trim().length > 0 &&
		value !== ABSENT
	);
}

/**
 * The passenger-facing booking reference: the first six characters, upper-cased.
 *
 * Falls back to the whole id when the id is shorter than the reference, so a
 * provider that already issues short ids is not truncated into nonsense.
 */
export function bookingReference(afsBookingId: string): string {
	const trimmed = afsBookingId.trim();
	if (trimmed.length === 0) {
		return "UNKNOWN";
	}
	return trimmed.slice(0, 6).toUpperCase();
}

/**
 * A short, stable handle for a hotel reservation.
 *
 * Hotel stays have no provider-issued reference — they are booked against our own
 * `HotelReservation` row — so the row id is formatted into one rather than
 * inventing a second identifier to store and keep unique. Zero-padded so the
 * reference is a fixed width and reads as a reference rather than a count, and
 * prefixed so a hotel reference can never be mistaken for a flight one.
 */
export function hotelReference(reservationId: number): string {
	return `H-${String(Math.trunc(reservationId)).padStart(6, "0")}`;
}

/**
 * One direction of travel, as a card.
 *
 * `from` / `to` are the ends of the whole direction; everything the direction is
 * made of is in `legs`, and `stops` is the transfers read out of it.
 */
export interface FlightDirection {
	/** `"outbound"` or `"return"`, used as the React key and the badge label. */
	kind: "outbound" | "return";
	/** Departure timestamp of the first leg, ISO string, or the sentinel. */
	departDate: string;
	/** Arrival timestamp of the last leg, ISO string, or the sentinel. */
	arriveDate: string;
	/** IATA code of the origin airport, or the sentinel when absent. */
	from: string;
	/** IATA code of the destination airport, or the sentinel when absent. */
	to: string;
	/**
	 * The airports this direction changes planes at, in flight order — empty for a
	 * direct flight, and for a booking whose legs were not recorded.
	 */
	stops: string[];
	/**
	 * The flights the direction is made of, in order.
	 *
	 * Always at least one entry: a booking whose legs were not recorded is shown
	 * as the single flight its four summary values describe, which is the shape
	 * every direction renders as.
	 */
	legs: FlightSegmentDto[];
}

/**
 * The leg columns as a page holds them.
 *
 * The endpoints always serialise `goLegs` / `returnLegs`, but the helper stays
 * tolerant of their absence: a booking whose legs were not recorded has only the
 * four summary values, and it still has to render.
 */
export type FlightDirectionInput = Omit<
	FlightLegDto,
	"goLegs" | "returnLegs"
> & {
	goLegs?: FlightSegmentDto[];
	returnLegs?: FlightSegmentDto[];
};

/**
 * Split a booking's `departure`/`arrival` columns into the directions flown.
 *
 * The return direction exists when either column carries a return value: the
 * two columns are written together by `buildFlightLegs` in `lib/reservations.ts`,
 * but a row can reach the table from outside that path — a backfill, a manual
 * repair, an import — and carry only one of them. Showing the leg with an `N/A`
 * for the missing half is more useful than silently dropping a flight the
 * passenger actually took.
 *
 * @returns one entry for a one-way booking, two for a round trip.
 */
export function flightDirections(
	departure: FlightDirectionInput,
	arrival: FlightDirectionInput
): FlightDirection[] {
	const outbound: FlightDirection = {
		kind: "outbound",
		departDate: departure.goDate,
		arriveDate: arrival.goDate,
		from: departure.goAirport,
		to: arrival.goAirport,
		...flownLegs(departure.goLegs, {
			from: departure.goAirport,
			to: arrival.goAirport,
			departDate: departure.goDate,
			arriveDate: arrival.goDate,
		}),
	};

	const directions: FlightDirection[] = [outbound];

	if (
		hasLegValue(departure.returnDate) ||
		hasLegValue(arrival.returnDate) ||
		hasLegValue(departure.returnAirport) ||
		hasLegValue(arrival.returnAirport)
	) {
		directions.push({
			kind: "return",
			departDate: departure.returnDate,
			arriveDate: arrival.returnDate,
			from: departure.returnAirport,
			to: arrival.returnAirport,
			...flownLegs(departure.returnLegs, {
				from: departure.returnAirport,
				to: arrival.returnAirport,
				departDate: departure.returnDate,
				arriveDate: arrival.returnDate,
			}),
		});
	}

	return directions;
}

/**
 * The legs of a direction, and the transfers they imply.
 *
 * `summary` is the single flight the four column values describe. It stands in
 * for the legs of a booking that did not record them — one row of "from → to"
 * instead of an empty list — so every direction renders the same way and a
 * booking without legs loses only its connections, not its journey.
 */
function flownLegs(
	stored: FlightSegmentDto[] | undefined,
	summary: FlightSegmentDto
): { legs: FlightSegmentDto[]; stops: string[] } {
	const legs = stored !== undefined && stored.length > 0 ? stored : [summary];
	return { legs, stops: transferAirports(legs) };
}

/**
 * The airports a direction changes planes at, in flight order.
 *
 * Every leg after the first begins at the airport the previous one landed at, so
 * those origins are the transfers — the same list as every leg's destination
 * except the last.
 *
 * Takes the stored flights as they come: the booking endpoints send the
 * serialised shape, and a page holding the raw JSON column (the itinerary pages
 * read one) has `null` where an absent field would be a sentinel. Both are
 * tolerated, because "where do I change planes" should not depend on which of the
 * two a page happens to hold.
 */
export function transferAirports(
	legs: readonly { from: string | null }[] | null | undefined
): string[] {
	return (legs ?? [])
		.slice(1)
		.map((leg) => leg.from)
		.filter((code): code is string => hasLegValue(code));
}

/**
 * Format a leg timestamp for display.
 *
 * The endpoints serialise `Date` columns to ISO strings, but a value that never
 * parsed — or the sentinel — must not render as `"Invalid Date"`.
 */
export function formatLegDate(
	value: string | Date | null | undefined,
	options: { dateOnly?: boolean } = {}
): string {
	if (value === null || value === undefined) return "N/A";
	if (typeof value === "string" && !hasLegValue(value)) return "N/A";
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) return "N/A";
	return options.dateOnly ? parsed.toLocaleDateString() : parsed.toLocaleString();
}

/** A whole number of nights between two stay dates, or `null` when unknown. */
export function stayNights(
	checkIn: string | Date | null | undefined,
	checkOut: string | Date | null | undefined
): number | null {
	if (checkIn === null || checkIn === undefined) return null;
	if (checkOut === null || checkOut === undefined) return null;
	const from = checkIn instanceof Date ? checkIn : new Date(checkIn);
	const to = checkOut instanceof Date ? checkOut : new Date(checkOut);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
	const nights = Math.round((to.getTime() - from.getTime()) / 86_400_000);
	return nights > 0 ? nights : null;
}
