/**
 * Contracts for the external Advanced Flights System (AFS) REST API.
 *
 * AFS is a third-party service reached over HTTP from `lib/afs-client.ts`. These
 * interfaces describe the subset of its payloads this project consumes. They are
 * hand written (AFS ships no schema) but validated at the boundary in
 * `lib/afs-client.ts` before use.
 */

/** An airport reference as embedded in AFS flight legs. */
export interface AfsAirport {
	id?: string;
	/** IATA code, e.g. `"PEK"`. */
	code: string;
	name: string;
	city: string;
	country: string;
}

/** An airline reference as embedded in AFS flight legs. */
export interface AfsAirline {
	code: string;
	name: string;
	base?: AfsAirport;
}

/** A single physical flight leg. */
export interface AfsFlight {
	id: string;
	flightNumber?: string;
	airline: AfsAirline;
	/** ISO-8601 departure timestamp. */
	departureTime: string;
	/** ISO-8601 arrival timestamp. */
	arrivalTime: string;
	origin: AfsAirport;
	destination: AfsAirport;
	price: number;
	currency?: string;
	availableSeats: number;
	/**
	 * ISO-8601 duration, e.g. `"PT2H30M"` — how AFS itself reports block time.
	 *
	 * Nothing in FlyNext may render this: it is a string, and every duration the
	 * UI shows is arithmetic on a number of minutes. `GET /api/flights/search`
	 * rewrites it to {@link durationMinutes} before the response leaves the
	 * server. It is kept on the type because it is genuinely part of the upstream
	 * payload.
	 */
	duration?: string;
	/**
	 * Block time in minutes. This is the field the results page reads, and the
	 * search endpoint guarantees it on every leg it returns.
	 */
	durationMinutes?: number;
	/** `"SCHEDULED"`, `"DELAYED"`, … */
	status: string;
}

/**
 * One itinerary option returned by `GET /api/flights`.
 *
 * A group with `legs === 1` is a direct flight; `legs === 2` is an outbound plus
 * a return leg. The FlyNext client renders these groups verbatim, so
 * `searchFlights()` must keep returning this exact envelope.
 */
export interface AfsFlightGroup {
	flights: AfsFlight[];
	legs: number;
	totalPrice: number;
	totalDuration?: number;
}

/** Response envelope of `GET /api/flights`. */
export interface AfsFlightSearchResponse {
	results: AfsFlightGroup[];
}

/** A city record from `GET /api/cities`. */
export interface AfsCity {
	city: string;
	country: string;
}

/** Request body of `POST /api/bookings`. */
export interface AfsCreateBookingRequest {
	email: string;
	firstName: string;
	lastName: string;
	passportNumber: string;
	flightIds: string[];
}

/** Response of `POST /api/bookings`. */
export interface AfsBooking {
	/**
	 * AFS's own identifier for the booking — a UUID upstream, and the only key
	 * that `GET /api/bookings/retrieve` and `POST /api/bookings/cancel` accept.
	 * Optional because the type also describes the payloads the browser receives,
	 * which carry {@link bookingReference} instead.
	 */
	id?: string;
	/** The passenger-facing reference shown in the UI. Derived from `id`. */
	bookingReference: string;
	ticketNumber?: string;
	status: string;
	flights: AfsFlight[];
}

/** Response of `GET /api/bookings/retrieve`. */
export interface AfsRetrievedBooking {
	bookingReference: string;
	status: string;
	flights: AfsFlight[];
	createdAt?: string;
}

/** The trimmed projection returned by {@link verifyFlight} / {@link cancelFlight}. */
export interface AfsBookingStatus {
	status: string;
	flights: AfsFlight[];
}

/** Query parameters accepted by `GET /api/flights`. */
export interface AfsFlightSearchParams {
	origin: string;
	destination: string;
	/** `YYYY-MM-DD`. */
	date: string;
}
