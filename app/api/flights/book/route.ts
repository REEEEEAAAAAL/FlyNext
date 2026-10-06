/**
 * `POST /api/flights/book`
 *
 * Books one or more flight legs through AFS and records a local
 * `FlightReservation`.
 *
 * Response contract, relied on by `app/flights/page.tsx` (two call sites:
 * one-way and round-trip):
 * - `401 { error: "Unauthorized" }`
 * - `400 { error: "Missing required fields: …" }`
 * - `429 { error: "Too many requests" }` — the write budget, see
 *   `lib/api/rate-limit.ts`
 * - `201 { message, bookingReference, ticketNumber, status, flights, reservationId }`
 * - `502 { error: string }` — AFS refused, or the ticket could not be mirrored
 *   locally (it is released again when that happens; see `createFlightReservation`)
 *
 * The stored `departure` / `arrival` JSON columns use the keys
 * `goDate` / `goAirport` / `returnDate` / `returnAirport`, which the booking
 * history pages read verbatim. They describe the two directions flown, not the
 * first two legs: `returnLegCount` is what tells the two apart.
 *
 * `flightIds` is one ordered itinerary, and AFS requires it to be in departure
 * order: a round trip is the outbound legs followed by the return legs, and the
 * first return leg must leave after the last outbound leg lands. The page checks
 * that before sending (see `bookingBlocker` in `app/flights/page.tsx`) so the
 * traveller gets an explanation, but the upstream `400` is surfaced unchanged
 * when a caller bypasses it — this route is not the place to guess which leg an
 * itinerary was meant to have.
 *
 * Only the fields AFS documents are forwarded: the request body is projected
 * field by field rather than passed through, so a caller cannot inject extra
 * properties into the upstream booking. `returnLegCount` is one of ours — it is
 * a property of the itinerary, not of the ticket — and is therefore consumed
 * here and never reaches the provider.
 */

import { badRequest } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonCreated } from "@/lib/api/response";
import { parseJsonBody } from "@/lib/api/validation";
import { createFlightReservation } from "@/lib/reservations";

/** Body fields the client always sends, in the order used by the error message. */
const REQUIRED_FIELDS = [
	"email",
	"firstName",
	"lastName",
	"passportNumber",
	"flightIds",
] as const;

/**
 * How many of the trailing `flightIds` are the flight home.
 *
 * Optional, because the split can be derived from the legs the provider returns
 * (see `splitFlightDirections`), but the caller that assembled the itinerary
 * knows it exactly — one search result per direction — and saying so is what
 * keeps a round trip from being read as a one-way with an overnight connection,
 * or the other way round. `0` declares a one-way booking.
 */
const RETURN_LEG_COUNT_FIELD = "returnLegCount";

/**
 * Bounds on the passenger fields, mirroring what the rest of the API accepts.
 *
 * The values are forwarded to AFS, so an unbounded string here is an unbounded
 * string in an upstream request. The passenger-facing limits are generous enough
 * that no real document or name is refused.
 */
const FIELD_LIMITS: Record<string, number> = {
	email: 254,
	firstName: 100,
	lastName: 100,
	passportNumber: 40,
};

/** Read `flightIds` as a non-empty array of non-empty strings. */
function readFlightIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw badRequest('Field "flightIds" must be an array of flight ids');
	}
	const ids: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim().length === 0) {
			throw badRequest('Field "flightIds" must contain non-empty strings');
		}
		ids.push(entry.trim());
	}
	if (ids.length === 0) {
		throw badRequest('Field "flightIds" must contain at least one flight id');
	}
	return ids;
}

/**
 * Read the optional return-leg count.
 *
 * Absent means "work it out from the legs" and is passed on as `undefined`; a
 * present value has to name a real split of `flightIds` — at least one leg out
 * and at least one leg home — because a count that leaves one half empty would
 * record a booking with a direction missing, and the traveller would only find
 * out from the history page.
 */
function readReturnLegCount(value: unknown, total: number): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw badRequest(`Field "${RETURN_LEG_COUNT_FIELD}" must be an integer`);
	}
	if (value < 0 || value >= total) {
		throw badRequest(
			`Field "${RETURN_LEG_COUNT_FIELD}" must leave at least one outbound ` +
				"and one return flight, or be 0 for a one-way booking"
		);
	}
	return value;
}

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");

	const body = await parseJsonBody(request);

	// A single "Missing required fields: …" message naming every absent field.
	const missing = REQUIRED_FIELDS.filter((field) => {
		const value = body[field];
		return (
			value === undefined ||
			value === null ||
			(typeof value === "string" && value.trim().length === 0)
		);
	});
	if (missing.length > 0) {
		throw badRequest(`Missing required fields: ${missing.join(", ")}`);
	}

	const email = String(body.email).trim();
	const firstName = String(body.firstName).trim();
	const lastName = String(body.lastName).trim();
	const passportNumber = String(body.passportNumber).trim();
	const flightIds = readFlightIds(body.flightIds);
	const returnLegCount = readReturnLegCount(
		body[RETURN_LEG_COUNT_FIELD],
		flightIds.length
	);

	for (const [field, value] of Object.entries({
		email,
		firstName,
		lastName,
		passportNumber,
	})) {
		const limit = FIELD_LIMITS[field];
		if (limit !== undefined && value.length > limit) {
			throw badRequest(`Field "${field}" must be at most ${limit} characters`);
		}
	}

	const { booking, reservationId } = await createFlightReservation(
		{ email, firstName, lastName, passportNumber, flightIds },
		userId,
		{ returnLegCount }
	);

	return jsonCreated({
		message: "Flight booking completed successfully",
		...booking,
		reservationId,
	});
});
