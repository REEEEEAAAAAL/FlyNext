/**
 * Input validation helpers.
 *
 * Request input arrives as `string | File | null` from `formData.get()`, as
 * `unknown` from `request.json()`, or as a string from the query string — none of
 * which is what Prisma accepts. Handing those values on unchecked produces `NaN`
 * prices, `null` where a `String` column is expected, and `500`s that should have
 * been `400`s. Every helper here either returns a value of the declared type or
 * throws {@link ApiError} with status `400`.
 */

import { badRequest } from "./errors";
import type { QueryValue } from "@/types";

/* -------------------------------------------------------------------------- */
/* JSON bodies                                                                */
/* -------------------------------------------------------------------------- */

/** Parse a request body and assert it is a JSON object. */
export async function parseJsonBody(
	request: Request
): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		throw badRequest("Request body must be valid JSON");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw badRequest("Request body must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

/** Read an optional trimmed string field from a parsed JSON object. */
export function readString(
	source: Record<string, unknown>,
	field: string,
	options: { maxLength?: number } = {}
): string | undefined {
	const value = source[field];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw badRequest(`Field "${field}" must be a string`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
		throw badRequest(`Field "${field}" must be at most ${options.maxLength} characters`);
	}
	return trimmed;
}

/** Read a required trimmed string field from a parsed JSON object. */
export function requireString(
	source: Record<string, unknown>,
	field: string,
	options: { maxLength?: number } = {}
): string {
	const value = readString(source, field, options);
	if (value === undefined) {
		throw badRequest(`Field "${field}" is required`);
	}
	return value;
}

/** Read and normalise an email address (trimmed, lower-cased). */
export function requireEmail(
	source: Record<string, unknown>,
	field = "email"
): string {
	const value = requireString(source, field, { maxLength: 254 }).toLowerCase();
	// Deliberately permissive but structurally enforced: local@label.tld
	if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
		throw badRequest(`Field "${field}" must be a valid email address`);
	}
	return value;
}

/**
 * Read an optional positive-integer id from a parsed JSON object.
 *
 * JSON has one number type and clients disagree about which shape an id takes,
 * so `"5"` and `5` are both accepted and mean the same id: the pages send
 * strings, while a hand-written request, a Postman collection or a third-party
 * client may well send a number, and neither should have to guess which one the
 * endpoint wants.
 *
 * Nothing else is coerced. `Number(true)` is `1` and `Number([5])` is `5`, so a
 * boolean or an array would quietly turn into a plausible id and the caller
 * would end up with a booking against the wrong record instead of a rejected
 * request. Floats, zero and negatives are not ids either. Every one of those is
 * a `400` naming the field.
 *
 * `null` and an empty string mean "not supplied", as they do in
 * {@link readString}, so an omitted id reaches the caller's own missing-field
 * error rather than a type error.
 */
export function readId(
	source: Record<string, unknown>,
	field: string
): number | undefined {
	const value = source[field];
	if (value === undefined || value === null) {
		return undefined;
	}

	let raw: string | number;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return undefined;
		}
		raw = trimmed;
	} else if (typeof value === "number") {
		raw = value;
	} else {
		throw badRequest(`Field "${field}" must be a positive integer`);
	}

	return assertPositiveInt(
		Number(raw),
		`Field "${field}" must be a positive integer`
	);
}

/** Read an optional finite number field from a parsed JSON object. */
export function readNumber(
	source: Record<string, unknown>,
	field: string
): number | undefined {
	const value = source[field];
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		throw badRequest(`Field "${field}" must be a number`);
	}
	return numeric;
}

/* -------------------------------------------------------------------------- */
/* Route segments                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Parse a dynamic route segment into a positive integer.
 *
 * A non-numeric segment is a client error (`400`), not a server error: coercing it
 * and handing it to Prisma would surface `/api/hotels/abc` as an opaque `500` that
 * says nothing about the actual mistake.
 */
export function parseRouteId(raw: string | undefined, field: string): number {
	if (raw === undefined) {
		throw badRequest(`Missing route parameter "${field}"`);
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw badRequest(`Route parameter "${field}" must be a positive integer`);
	}
	return value;
}

/**
 * The single definition of a valid identifier: a positive integer.
 *
 * The query-string and body parsers share it so the rule cannot drift apart, and
 * pass the message in so each can describe its input the way that input reaches
 * the endpoint (`Parameter`, `Field`, …).
 */
function assertPositiveInt(value: number, message: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw badRequest(message);
	}
	return value;
}

/**
 * Parse an optional integer query value, or a body value already narrowed to a
 * string or a number by {@link readId}.
 */
export function parseOptionalPositiveInt(
	raw: QueryValue | number | undefined,
	field: string
): number | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (typeof raw === "string" && raw.trim() === "") {
		return undefined;
	}
	return assertPositiveInt(
		Number(raw),
		`Parameter "${field}" must be a positive integer`
	);
}

/** Parse an optional non-negative integer (availability counts). */
export function parseOptionalNonNegativeInt(
	raw: QueryValue | undefined,
	field: string
): number | undefined {
	if (raw === undefined || raw === null || raw.trim() === "") {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw badRequest(`Parameter "${field}" must be a non-negative integer`);
	}
	return value;
}

/** Parse an optional finite number bounded to a range. */
export function parseOptionalNumber(
	raw: QueryValue | undefined,
	field: string,
	options: { min?: number; max?: number } = {}
): number | undefined {
	if (raw === undefined || raw === null || raw.trim() === "") {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		throw badRequest(`Parameter "${field}" must be a number`);
	}
	if (options.min !== undefined && value < options.min) {
		throw badRequest(`Parameter "${field}" must be at least ${options.min}`);
	}
	if (options.max !== undefined && value > options.max) {
		throw badRequest(`Parameter "${field}" must be at most ${options.max}`);
	}
	return value;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/** Normalise a date to local midnight, matching the availability rows. */
export function atMidnight(date: Date): Date {
	const copy = new Date(date.getTime());
	copy.setHours(0, 0, 0, 0);
	return copy;
}

/**
 * How far ahead a room type's calendar is open for booking, in nights.
 *
 * A count of nights rather than a count of months, because a month is not a
 * fixed length and `setMonth` also rolls over: from 31 January, "two months
 * later" is 31 March, while from 1 February it is 1 April. A stay inside the
 * promised window could therefore be told `"The selected date is not supported
 * for booking."` purely because of which day the guest happened to be booking
 * from. Sixty nights is always sixty nights.
 */
export const AVAILABILITY_HORIZON_DAYS = 60;

/**
 * The inclusive list of nights a room type's calendar covers, from today.
 *
 * `GET .../room-types/[roomTypeId]` and `POST .../room-types` both build their
 * rows from this, so a night cannot exist in one window and not the other, and
 * `POST /api/hotels/book` auto-fills the same window rather than refusing a stay
 * that falls inside it.
 */
export function availabilityHorizon(today: Date = new Date()): {
	start: Date;
	end: Date;
	days: Date[];
} {
	const start = atMidnight(today);
	const end = addDays(start, AVAILABILITY_HORIZON_DAYS);
	return { start, end, days: eachDateInclusive(start, end) };
}

/**
 * Is `night` a date a booking may still claim?
 *
 * The single definition of "bookable", shared by the hotel booking route and its
 * tests. It is a range test on the calendar day rather than a comparison of
 * timestamps: every availability row and every parsed stay is local midnight, and
 * comparing instants would make the answer depend on the reader's time zone.
 *
 * Past nights are not bookable, and the horizon is inclusive so the last night of
 * the window is.
 */
export function isWithinAvailabilityHorizon(
	night: Date,
	today: Date = new Date()
): boolean {
	const { start, end } = availabilityHorizon(today);
	const day = atMidnight(night).getTime();
	return day >= start.getTime() && day <= end.getTime();
}

/** `date` shifted by `days`, keeping the local wall-clock time. */
export function addDays(date: Date, days: number): Date {
	const copy = new Date(date.getTime());
	copy.setDate(copy.getDate() + days);
	return copy;
}

/** Calendar-date shape accepted from clients. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a `YYYY-MM-DD` date into local midnight.
 *
 * The format is required rather than merely accepted. `new Date()` is lenient in
 * two ways that both matter for a booking: it rolls impossible days forward
 * (`"2026-02-30"` becomes 2 March) and it parses bare numbers as years (`"1"` is
 * 2001). A stay would then be recorded for a night the traveller never chose, and
 * the availability rows would be decremented for that night. The day is therefore
 * checked back against the parsed result, which is what rejects the rollover.
 *
 * Local midnight is the granularity the availability rows are stored at, so a
 * `Date` built from the parts is already aligned; the UTC-parsed
 * `new Date("2026-03-01")` would land on the previous day west of UTC.
 */
export function parseDateOnly(raw: string, field: string): Date {
	const match = DATE_ONLY_PATTERN.exec(raw.trim());
	if (match === null) {
		throw badRequest(`Parameter "${field}" must be a date in YYYY-MM-DD format`);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(year, month - 1, day);
	if (
		parsed.getFullYear() !== year ||
		parsed.getMonth() !== month - 1 ||
		parsed.getDate() !== day
	) {
		throw badRequest(`Parameter "${field}" is not a real calendar date`);
	}
	return atMidnight(parsed);
}

/**
 * Parse a hotel stay, enforcing `checkOut` strictly after `checkIn`.
 *
 * `nights` is derived from a validated, ordered range. Computing it from an
 * absolute difference instead would price a reversed range positively while the
 * availability loop covering the stay never ran — a booking that is both free and
 * unchecked.
 */
export function parseStayRange(
	checkInRaw: string,
	checkOutRaw: string
): { checkIn: Date; checkOut: Date; nights: number } {
	const checkIn = parseDateOnly(checkInRaw, "checkIn");
	const checkOut = parseDateOnly(checkOutRaw, "checkOut");
	if (checkOut.getTime() <= checkIn.getTime()) {
		throw badRequest("checkOut must be after checkIn");
	}
	const nights = Math.round(
		(checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
	);
	return { checkIn, checkOut, nights };
}

/** Enumerate every midnight between `start` (inclusive) and `end` (exclusive). */
export function eachNight(start: Date, end: Date): Date[] {
	const nights: Date[] = [];
	const cursor = atMidnight(start);
	while (cursor.getTime() < end.getTime()) {
		nights.push(new Date(cursor.getTime()));
		cursor.setDate(cursor.getDate() + 1);
	}
	return nights;
}

/** Enumerate every midnight between `start` and `end`, both inclusive. */
export function eachDateInclusive(start: Date, end: Date): Date[] {
	const dates: Date[] = [];
	const cursor = atMidnight(start);
	while (cursor.getTime() <= end.getTime()) {
		dates.push(new Date(cursor.getTime()));
		cursor.setDate(cursor.getDate() + 1);
	}
	return dates;
}

/* -------------------------------------------------------------------------- */
/* multipart/form-data                                                        */
/* -------------------------------------------------------------------------- */

/** Read an optional text field from a `FormData` body. */
export function readFormString(
	formData: FormData,
	field: string,
	options: { maxLength?: number } = {}
): string | undefined {
	const value = formData.get(field);
	if (value === null) {
		return undefined;
	}
	// A `File` where a scalar is expected is a malformed request; ignore it
	// rather than letting it reach Prisma as an object.
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
		throw badRequest(`Field "${field}" must be at most ${options.maxLength} characters`);
	}
	return trimmed;
}

/** Read a required text field from a `FormData` body. */
export function requireFormString(
	formData: FormData,
	field: string,
	options: { maxLength?: number } = {}
): string {
	const value = readFormString(formData, field, options);
	if (value === undefined) {
		throw badRequest(`Missing required field: ${field}`);
	}
	return value;
}

/** Read a required integer between `min` and `max` from a `FormData` body. */
export function requireFormInt(
	formData: FormData,
	field: string,
	options: { min?: number; max?: number } = {}
): number {
	const raw = requireFormString(formData, field);
	const value = Number(raw);
	if (!Number.isInteger(value)) {
		throw badRequest(`Field "${field}" must be an integer`);
	}
	if (options.min !== undefined && value < options.min) {
		throw badRequest(`Field "${field}" must be at least ${options.min}`);
	}
	if (options.max !== undefined && value > options.max) {
		throw badRequest(`Field "${field}" must be at most ${options.max}`);
	}
	return value;
}

/** Read a required finite number from a `FormData` body. */
export function requireFormNumber(
	formData: FormData,
	field: string,
	options: { min?: number; max?: number } = {}
): number {
	const raw = requireFormString(formData, field);
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		throw badRequest(`Field "${field}" must be a number`);
	}
	if (options.min !== undefined && value < options.min) {
		throw badRequest(`Field "${field}" must be at least ${options.min}`);
	}
	if (options.max !== undefined && value > options.max) {
		throw badRequest(`Field "${field}" must be at most ${options.max}`);
	}
	return value;
}

/** Collect the uploaded `File`s stored under one `FormData` key. */
export function readFormFiles(formData: FormData, field: string): File[] {
	const entries = formData.getAll(field);
	const files: File[] = [];
	for (const entry of entries) {
		// Non-file entries are existing image URLs and are handled separately.
		if (typeof entry !== "string" && entry.size > 0) {
			files.push(entry);
		}
	}
	return files;
}

/** Collect the string entries (existing image URLs) stored under one key. */
export function readFormStrings(formData: FormData, field: string): string[] {
	return formData
		.getAll(field)
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}
