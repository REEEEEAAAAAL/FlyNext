/**
 * Notification writes that follow a business event.
 *
 * A notification is an effect of something that already happened — a booking
 * was made, a stay was cancelled — not a condition of it. The distinction matters
 * because of how the client reacts to a failure: `app/hotels/page.tsx` reports any
 * non-OK response as "the booking failed", so a notification that fails after a
 * booking has committed would tell the user their booking failed and invite a
 * retry that books a second time.
 *
 * Every notification that cannot be written inside the transaction it belongs to
 * therefore goes through {@link notify}, which records a failure instead of
 * propagating it. Bookings created inside a transaction should still write their
 * notification with `tx.notification` and keep it atomic; this helper is for the
 * rows that are produced after the transaction has already closed.
 */

import { reportAlert } from "./events";
import { prisma } from "../prisma";

/** Details attached to a failed-notification record, for the operator. */
export interface NotifyOptions {
	/** What the notification was about, e.g. `"hotel-cancellation"`. */
	readonly event: string;
	/** Recipient. */
	readonly userId: number;
	/** Notification body. */
	readonly content: string;
}

/**
 * Write a notification, swallowing and reporting any failure.
 *
 * @returns `true` when the row was written.
 */
export async function notify(options: NotifyOptions): Promise<boolean> {
	try {
		await prisma.notification.create({
			data: { userId: options.userId, content: options.content },
		});
		return true;
	} catch (error) {
		reportAlert("notification.write-failed", {
			event: options.event,
			userId: options.userId,
			reason: error instanceof Error ? error.message : "unknown error",
		});
		return false;
	}
}
