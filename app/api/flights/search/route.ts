/**
 * `GET /api/flights/search?origin=&destination=&date=`
 *
 * Public endpoint (no `Authorization` header is sent by the client).
 *
 * Response contract, relied on by `app/flights/page.tsx`:
 * - `200` — the body is a bare array of flight groups, which the page maps
 *   over directly (`data.map(...)`). Wrapping it in `{ flights: [...] }` breaks
 *   the results page. This is the only bare-array response in the API. Every leg
 *   carries a numeric `durationMinutes`; the raw ISO-8601 `duration` string AFS
 *   sends is removed, because the page formats durations as numbers and a string
 *   renders as `NaNh NaNm`.
 * - `400 { error: string }` — a missing or malformed parameter, rejected before
 *   the upstream call is made.
 * - `502 { error: string }` — AFS failed, or refused the API key. An upstream
 *   `401` is never relayed: the browser reads `401` as "your session expired" and
 *   would log the user out because a third party rejected the credentials.
 */

import { badRequest } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { searchFlights } from "@/lib/afs-client";
import type { AfsFlight, AfsFlightGroup } from "@/types";

/** `YYYY-MM-DD`, the only date format AFS accepts. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `PT2H35M` / `PT45M` / `PT0M`, the ISO-8601 duration AFS reports. */
const ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

/**
 * Block time in minutes.
 *
 * The results page does arithmetic on this value — it sums the legs of a
 * connection and formats the total as `Xh Ym` — so a string here renders as
 * `NaNh NaNm` instead of failing loudly. AFS reports `duration` as an ISO-8601
 * string, so it has to be converted once, here, rather than in the page: the
 * page receives its data from a `fetch` and has no way to check it.
 *
 * The offline provider states both fields and its numeric one is authoritative;
 * the ISO string is the fallback for a remote AFS that sends only that.
 *
 * @returns the duration in minutes, or `undefined` when neither field is usable.
 */
function durationMinutes(flight: AfsFlight): number | undefined {
	const { durationMinutes: minutes, duration } = flight;
	if (typeof minutes === "number" && Number.isFinite(minutes)) {
		return minutes;
	}
	if (typeof duration !== "string") {
		return undefined;
	}
	const match = ISO_DURATION_PATTERN.exec(duration.trim());
	if (match === null) {
		return undefined;
	}
	const [, hours, mins, seconds] = match;
	const total =
		Number(hours ?? 0) * 60 +
		Number(mins ?? 0) +
		Math.round(Number(seconds ?? 0) / 60);
	return total > 0 ? total : 0;
}

/**
 * One group with every leg carrying a numeric duration.
 *
 * The ISO string is dropped rather than returned alongside the number. A field
 * named `duration` that holds `"PT2H35M"` is what the results page rendered as
 * `NaNh NaNm`; leaving it in the payload keeps that trap loaded for the next
 * consumer, and nothing in FlyNext reads it.
 *
 * `totalDuration` is the legs' combined block time, not the elapsed time from
 * first departure to last arrival: the page lists each leg's own duration
 * underneath, and a total that quietly included the layover would not add up.
 */
function withDurations(group: AfsFlightGroup): AfsFlightGroup {
	const flights = group.flights.map((flight) => {
		const { duration: _iso, ...rest } = flight;
		const minutes = durationMinutes(flight);
		return minutes === undefined ? rest : { ...rest, durationMinutes: minutes };
	});

	const totalDuration = flights.reduce(
		(sum, flight) =>
			typeof flight.durationMinutes === "number"
				? sum + flight.durationMinutes
				: sum,
		0
	);

	return {
		...group,
		flights,
		...(flights.length > 0 ? { totalDuration } : {}),
	};
}

export const GET = withRoute(async (request) => {
	const { searchParams } = new URL(request.url);

	const origin = (searchParams.get("origin") ?? "").trim();
	const destination = (searchParams.get("destination") ?? "").trim();
	const date = (searchParams.get("date") ?? "").trim();

	if (origin.length === 0 || destination.length === 0 || date.length === 0) {
		throw badRequest(
			"Missing required query parameters: origin, destination, date"
		);
	}
	if (!ISO_DATE_PATTERN.test(date)) {
		throw badRequest('Query parameter "date" must use the YYYY-MM-DD format');
	}

	const groups = await searchFlights({ origin, destination, date });

	// Bare array: the response body is the groups collection itself.
	return jsonOk(groups.map(withDurations));
});
