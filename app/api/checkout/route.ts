/**
 * `POST /api/checkout`
 *
 * Marks a DRAFT itinerary as CONFIRMED and stores the card's last four digits.
 *
 * Response contract, relied on by `app/checkout/page.tsx`:
 * - `401 { error: "Unauthorized" }`
 * - `404 { error: "Itinerary not found or access denied" }`
 * - `409 { error: string }` — the itinerary was cancelled, or another checkout won
 * - `400 { error: string }`
 * - `429 { error: string }` — checkout has the tightest write budget on the API
 * - `200 { message: "Checkout successful", itinerary: { … } }`
 *
 * The state transition is a single conditional `updateMany` scoped to the caller
 * and to `status != CANCELLED`. Reading the itinerary first and then updating it
 * would allow two things this prevents: a cancelled itinerary — whose bookings
 * are already released and whose total is zero — being revived as `CONFIRMED`,
 * and two concurrent checkouts both succeeding.
 *
 * No payment is actually processed and no PAN is transmitted — only the
 * last four digits are persisted, matching the `Itinerary.cardNumber` contract.
 */

import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { parseJsonBody, readId, readString } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

/** Digits after spaces and hyphens are removed. */
const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;

/** `MM/YY` or `MM/YYYY`. */
const CARD_EXPIRY_PATTERN = /^(0?[1-9]|1[0-2])\/\d{2}(\d{2})?$/;

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "checkout");
	const body = await parseJsonBody(request);

	// `readId` accepts `5` and `"5"` alike; anything that is not a positive
	// integer is a `400`.
	const itineraryId = readId(body, "itineraryId");
	const cardNumberRaw = readString(body, "cardNumber", { maxLength: 40 });
	const cardExpiry = readString(body, "cardExpiry", { maxLength: 10 });

	if (itineraryId === undefined || cardNumberRaw === undefined || cardExpiry === undefined) {
		throw badRequest("Missing required fields");
	}

	// Strip the separators a user may type; keep digits only.
	const digits = cardNumberRaw.replace(/[\s-]/g, "");
	if (!/^\d+$/.test(digits) || digits.length < MIN_CARD_DIGITS || digits.length > MAX_CARD_DIGITS) {
		throw badRequest(
			`Invalid card number: expected between ${MIN_CARD_DIGITS} and ${MAX_CARD_DIGITS} digits`
		);
	}
	if (!CARD_EXPIRY_PATTERN.test(cardExpiry)) {
		throw badRequest('Invalid card expiry: expected the "MM/YY" format');
	}

	// Only the last four digits are ever stored.
	const last4Digits = digits.slice(-4);

	// Ownership and the status transition are asserted by the same statement, so
	// there is no window between "may I?" and "do it".
	const claimed = await prisma.itinerary.updateMany({
		where: { id: itineraryId, userId, status: { not: "CANCELLED" } },
		data: {
			cardNumber: last4Digits,
			cardExpiry,
			status: "CONFIRMED",
		},
	});

	if (claimed.count === 0) {
		// Nothing matched. Either the caller has no such itinerary, or the only
		// matching one is cancelled; distinguish them without leaking whether
		// somebody else's itinerary exists.
		const existing = await prisma.itinerary.findFirst({
			where: { id: itineraryId, userId },
			select: { status: true },
		});
		if (existing === null) {
			throw notFound("Itinerary not found or access denied");
		}
		throw conflict("This itinerary has been cancelled and cannot be checked out");
	}

	const itinerary = await prisma.itinerary.findUnique({
		where: { id: itineraryId },
	});

	return jsonOk({
		message: "Checkout successful",
		itinerary,
	});
});
