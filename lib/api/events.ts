/**
 * Structured, machine-searchable event log.
 *
 * Routing these signals through `console.warn("[event] " + JSON.stringify(…))`
 * keeps them distinguishable from the free-form diagnostics around them, so a log
 * query can pick out every occurrence of one `event` name and aggregate its
 * `detail` fields without parsing prose. The functions here are deliberately thin:
 * they exist to fix the shape of the record, not to hide the logging call.
 *
 * The events that matter operationally are the ones describing a state the system
 * could not repair by itself — see `flight.booking.orphaned` in
 * `lib/reservations.ts`. Those records are the input to manual reconciliation with
 * the upstream provider, so they carry every identifier needed to act on them.
 */

/** Extra, event-specific fields. Values must be JSON-serialisable. */
export type EventDetail = Record<string, string | number | boolean | null>;

/** One machine-readable record. */
interface EventRecord {
	/** Dotted, stable, lower-case identifier, e.g. `"flight.booking.orphaned"`. */
	event: string;
	/** Wall-clock time the record was written. */
	at: string;
	/** Whether the condition needs an operator to intervene. */
	alert: boolean;
	detail: EventDetail;
}

/** Monotonic-ish counter, so records from one process can be ordered. */
let sequence = 0;

function write(
	level: "warn" | "error",
	alert: boolean,
	event: string,
	detail: EventDetail
): void {
	const record: EventRecord = {
		event,
		at: new Date().toISOString(),
		alert,
		detail,
	};
	// The sequence number is not part of the record's schema; it is prepended so
	// that two records written in the same millisecond keep their order.
	console[level](`[event] ${++sequence} ${JSON.stringify(record)}`);
}

/**
 * Record a condition an operator should look at.
 *
 * Use this when the code has already tried to repair the state and could not.
 */
export function reportAlert(event: string, detail: EventDetail): void {
	write("error", true, event, detail);
}

/** Record a noteworthy but self-resolved condition, such as a successful rollback. */
export function reportEvent(event: string, detail: EventDetail): void {
	write("warn", false, event, detail);
}
