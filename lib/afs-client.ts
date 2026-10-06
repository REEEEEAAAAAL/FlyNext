/**
 * Client for the Advanced Flights System (AFS) flight provider.
 *
 * AFS is a third-party service, so its responses are treated as untrusted: every
 * payload is structurally validated before it is returned as a typed value.
 * TypeScript cannot check data that crossed the network, so the raw body is
 * narrowed here rather than cast — which is what turns a missing `flights` array,
 * or a status read off an array instead of a leg, into a readable `502` instead
 * of a `TypeError` deep inside a page.
 *
 * ## Two back ends, one contract
 *
 * Two interchangeable implementations satisfy the contract, chosen per call by
 * `lib/afs/config.ts`:
 *
 * - remote — HTTP against a running AFS server: the container in this
 *   repository's `docker-compose.yml`, or any other deployment of
 *   <https://github.com/Kianoosh76/afs>.
 * - offline — `lib/afs/offline.ts`, an in-process implementation of the same
 *   payloads that needs no network. It is what keeps flight search, booking,
 *   ticketing and the refund/compensation path working on Vercel and in CI, where
 *   an AFS container running on a local machine is not reachable.
 *
 * Everything below this line is transport agnostic: the exported functions keep
 * the same signatures and the same `ApiError` taxonomy whichever back end
 * answers, so no route handler or page has to know which one is in play. Call
 * {@link isAfsOffline} to find out.
 *
 * Errors are raised as {@link ApiError} with status `502 Bad Gateway`. An
 * upstream status is deliberately not forwarded: the browser client reads
 * `401` as "your session expired", so relaying AFS's own `401` would log the user
 * out because a third party rejected our API key. The upstream status is kept in
 * `details` for the log and for the client's error text.
 */

import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { badGateway, toErrorMessage } from "./api/errors";
import {
	DOCKER_AFS_BASE_URL,
	LOCAL_AFS_BASE_URL,
	isAfsOffline,
	resolveAfsMode,
} from "./afs/config";
import * as offline from "./afs/offline";
import { noteOfflineMode } from "./afs/offline";
import type {
	AfsAirport,
	AfsAirline,
	AfsBooking,
	AfsBookingStatus,
	AfsCity,
	AfsCreateBookingRequest,
	AfsFlight,
	AfsFlightGroup,
	AfsFlightSearchParams,
	AfsRetrievedBooking,
} from "@/types";

export { isAfsOffline, LOCAL_AFS_BASE_URL, DOCKER_AFS_BASE_URL };
export { offlineStats } from "./afs/offline";

/* -------------------------------------------------------------------------- */
/* HTTP client                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The axios instance, built on first use.
 *
 * It is cached per base URL rather than cached once: on a long-lived dev server
 * the environment can change between calls, and a single cached client would
 * keep sending requests to whichever address was configured first.
 */
let cachedClient: { baseURL: string; client: AxiosInstance } | null = null;

/**
 * The client for `baseURL`, or a clear error when HTTP mode cannot work.
 *
 * Only reached in remote mode, so a missing `AFS_API_KEY` here is a genuine
 * misconfiguration. It is thrown as a plain `Error` rather than an `ApiError`
 * because the caller is already inside the per-endpoint `try`/`catch`, which
 * turns it into the `502` a provider failure would produce anyway — with the
 * actionable message preserved in the logs.
 */
function getClient(baseURL: string): AxiosInstance {
	const apiKey = process.env.AFS_API_KEY;
	if (!apiKey) {
		throw new Error(
			"AFS_API_KEY must be set, or set AFS_MOCK=true to run against the " +
				"built-in offline provider. See .env.example."
		);
	}
	if (cachedClient !== null && cachedClient.baseURL === baseURL) {
		return cachedClient.client;
	}
	const client = axios.create({
		baseURL,
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		// Fail fast instead of hanging a request handler indefinitely.
		timeout: 15_000,
	});
	cachedClient = { baseURL, client };
	return client;
}

/**
 * The remote AFS client, or `undefined` when calls are served offline.
 *
 * The mode is resolved on every call rather than cached at import time: route
 * handlers are imported once per process, so a module-level decision would freeze
 * whichever value happened to be in the environment first and could never be
 * overridden by a test.
 */
function remoteClient(): AxiosInstance | undefined {
	const resolution = resolveAfsMode();
	if (resolution.mode === "offline" || resolution.baseUrl === undefined) {
		noteOfflineMode(resolution.reason);
		return undefined;
	}
	return getClient(resolution.baseUrl);
}

/* -------------------------------------------------------------------------- */
/* Response validation                                                        */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Best-effort extraction of a human readable message from an upstream error. */
function upstreamMessage(data: unknown): string {
	if (isRecord(data) && typeof data.message === "string") {
		return data.message;
	}
	return "no message";
}

/**
 * Translate any failure into an `ApiError` carrying `502`.
 *
 * @param action human readable prefix, e.g. `"Flight search failed"`.
 */
function upstreamFailure(action: string, error: unknown): never {
	if (axios.isAxiosError(error)) {
		const status = error.response?.status;
		const detail =
			status === undefined ? "no response" : `upstream status ${status}`;
		throw badGateway(
			`${action}: ${upstreamMessage(error.response?.data)}`,
			detail
		);
	}
	throw badGateway(`${action}: ${toErrorMessage(error)}`);
}

/** Assert that a validated response body is a JSON array. */
function expectArray(data: unknown, action: string): unknown[] {
	if (!Array.isArray(data)) {
		throw badGateway(`${action}: upstream returned a non-array payload`);
	}
	return data;
}

/** Assert that a validated response body is a JSON object. */
function expectRecord(data: unknown, action: string): Record<string, unknown> {
	if (!isRecord(data)) {
		throw badGateway(`${action}: upstream returned a malformed payload`);
	}
	return data;
}

/**
 * Validate one flight-group entry.
 *
 * The browser client calls `.map()`, `.reduce()` and `group.flights.length`
 * directly on these objects, so a missing `flights` array would crash the
 * results page. Failing here turns that into a readable API error instead.
 */
function toFlightGroup(value: unknown, action: string): AfsFlightGroup {
	const record = expectRecord(value, action);
	if (!Array.isArray(record.flights)) {
		throw badGateway(`${action}: upstream flight group is missing "flights"`);
	}
	const legs = record.legs;
	const totalPrice = record.totalPrice;
	return {
		flights: record.flights as AfsFlight[],
		legs: typeof legs === "number" ? legs : record.flights.length,
		totalPrice: typeof totalPrice === "number" ? totalPrice : 0,
		...(typeof record.totalDuration === "number"
			? { totalDuration: record.totalDuration }
			: {}),
	};
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the list of cities served by AFS.
 *
 * Offline mode answers from the built-in network, so the flight search form's
 * autocomplete is populated without a provider.
 */
export async function getCities(): Promise<AfsCity[]> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.getCities();
	}
	const action = "Failed to fetch cities";
	try {
		const response: AxiosResponse<unknown> = await client.get("/api/cities");
		return expectArray(response.data, action) as AfsCity[];
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/** Fetch the list of airports known to AFS. */
export async function getAirports(): Promise<AfsAirport[]> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.getAirports();
	}
	const action = "Failed to fetch airports";
	try {
		const response: AxiosResponse<unknown> = await client.get("/api/airports");
		return expectArray(response.data, action) as AfsAirport[];
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/** Fetch the list of airlines known to AFS. */
export async function getAirlines(): Promise<AfsAirline[]> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.getAirlines();
	}
	const action = "Failed to fetch airlines";
	try {
		const response: AxiosResponse<unknown> = await client.get("/api/airlines");
		return expectArray(response.data, action) as AfsAirline[];
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/**
 * Search flights.
 *
 * @returns the flight groups array, which `GET /api/flights/search` must
 *   keep returning as the bare response body.
 */
export async function searchFlights(
	params: AfsFlightSearchParams
): Promise<AfsFlightGroup[]> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.searchFlights(params);
	}
	const action = "Flight search failed";
	try {
		const response: AxiosResponse<unknown> = await client.get("/api/flights", {
			params,
		});
		const body = expectRecord(response.data, action);
		const results = body.results;
		if (!Array.isArray(results)) {
			throw badGateway(`${action}: upstream response is missing "results"`);
		}
		return results.map((group) => toFlightGroup(group, action));
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/** Create a flight booking. */
export async function createBooking(
	bookingData: AfsCreateBookingRequest
): Promise<AfsBooking> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.createBooking(bookingData);
	}
	const action = "Booking failed";
	try {
		const response: AxiosResponse<unknown> = await client.post(
			"/api/bookings",
			bookingData
		);
		const record = expectRecord(response.data, action);
		if (
			typeof record.bookingReference !== "string" ||
			!Array.isArray(record.flights)
		) {
			throw badGateway(`${action}: upstream returned an incomplete booking`);
		}
		return {
			bookingReference: record.bookingReference,
			status: typeof record.status === "string" ? record.status : "CONFIRMED",
			flights: record.flights as AfsFlight[],
			...(typeof record.ticketNumber === "string"
				? { ticketNumber: record.ticketNumber }
				: {}),
		};
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/** Retrieve a booking by passenger surname and booking reference. */
export async function retrieveBooking(
	lastName: string,
	bookingReference: string
): Promise<AfsRetrievedBooking> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.retrieveBooking(lastName, bookingReference);
	}
	const action = "Retrieve booking failed";
	try {
		const response: AxiosResponse<unknown> = await client.get(
			"/api/bookings/retrieve",
			{ params: { lastName, bookingReference } }
		);
		const record = expectRecord(response.data, action);
		return {
			bookingReference:
				typeof record.bookingReference === "string"
					? record.bookingReference
					: bookingReference,
			status: typeof record.status === "string" ? record.status : "UNKNOWN",
			flights: Array.isArray(record.flights)
				? (record.flights as AfsFlight[])
				: [],
			...(typeof record.createdAt === "string"
				? { createdAt: record.createdAt }
				: {}),
		};
	} catch (error) {
		return upstreamFailure(action, error);
	}
}

/** Verify a booking's current status. */
export async function verifyFlight(
	bookingReference: string,
	lastName: string
): Promise<AfsBookingStatus> {
	const booking = await retrieveBooking(lastName, bookingReference);
	return { status: booking.status, flights: booking.flights };
}

/** Cancel a booking. */
export async function cancelFlight(
	bookingReference: string,
	lastName: string
): Promise<AfsBookingStatus> {
	const client = remoteClient();
	if (client === undefined) {
		return offline.cancelBooking(bookingReference, lastName);
	}
	const action = "Cancellation failed";
	try {
		const response: AxiosResponse<unknown> = await client.post(
			"/api/bookings/cancel",
			{ bookingReference, lastName }
		);
		const record = expectRecord(response.data, action);
		return {
			status: typeof record.status === "string" ? record.status : "UNKNOWN",
			flights: Array.isArray(record.flights)
				? (record.flights as AfsFlight[])
				: [],
		};
	} catch (error) {
		return upstreamFailure(action, error);
	}
}
