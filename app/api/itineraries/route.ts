/**
 * `GET  /api/itineraries` — list the caller's itineraries.
 * `POST /api/itineraries` — link flight/hotel reservations into a DRAFT itinerary.
 *
 * Response contract, relied on by `app/itineraries/page.tsx`,
 * `app/itineraries/new/page.tsx` and `app/checkout/page.tsx`:
 * - `200 { itineraries: ItineraryListItem[] }`
 * - `201 { message: "Itinerary created successfully", reservations: { id, … } }`
 *   — `app/itineraries/new/page.tsx` reads `data.reservations.id`
 * - `400`, `401`, `403`, `404`, `409 { error: string }`
 *
 * A reservation is attached with a conditional `updateMany` on `itineraryId: null`
 * and the claim is asserted. The link column is `@unique`, which stops two rows
 * from sharing a value but does not stop one row's value from being overwritten,
 * so a non-locking pre-read followed by an unconditional `update` would let two
 * concurrent requests attach the same reservation — the second silently stealing
 * it from the first itinerary, which would then be left with a total that no
 * longer matches the bookings it references.
 *
 * That claim is the only write the transaction has to make, so everything the
 * database can be asked beforehand (ownership, cancellation, price) is asked
 * beforehand, as one batched read outside the transaction. An interactive
 * transaction holds a dedicated connection and is bounded by
 * `DEFAULT_TRANSACTION_OPTIONS` (`lib/prisma.ts`); measured against the deployed
 * Neon instance a single round trip takes hundreds of milliseconds, so the
 * transaction makes four of them and no more: a longer sequence of sequential
 * round trips is enough to trip the transaction timeout and answer `P2028`
 * ("Transaction already closed") while the client sees a `500` that a second
 * attempt does not reproduce. The shared budget absorbs the cold path.
 */

import { requireAuth } from "@/lib/api/auth";
import { type ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonCreated, jsonOk } from "@/lib/api/response";
import { parseJsonBody, readId } from "@/lib/api/validation";
import { DEFAULT_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);

	const itineraries = await prisma.itinerary.findMany({
		where: { userId },
		select: {
			id: true,
			flight: true,
			hotel: {
				select: {
					hotel: {
						select: { name: true, address: true, location: true },
					},
					roomType: { select: { name: true } },
					checkIn: true,
					checkOut: true,
					price: true,
					status: true,
				},
			},
			totalPrice: true,
			bookingDate: true,
			status: true,
		},
		orderBy: { bookingDate: "desc" },
	});

	return jsonOk({ itineraries });
});

/**
 * Signals that a reservation could not be attached to the new itinerary.
 *
 * Carries the status and message the response should use, so that the transaction
 * callback can fail with the right HTTP semantics while the outer handler remains
 * a single linear function.
 */
class ReservationNotLinkable extends Error {
	/** `404` for a missing row, `403` for a foreign one, `409` for a taken one. */
	readonly apiError: ApiError;

	constructor(apiError: ApiError) {
		super(apiError.message);
		this.name = "ReservationNotLinkable";
		this.apiError = apiError;
	}
}

/** Reservation kinds, with the label each one's error messages use. */
const FLIGHT_OP = { kind: "flight", label: "Flight" } as const;
const HOTEL_OP = { kind: "hotel", label: "Hotel" } as const;

/** Either reservation kind. */
type LinkOp = typeof FLIGHT_OP | typeof HOTEL_OP;

/** The reservation a request asks to attach, and the kind it belongs to. */
interface LinkRequest {
	op: LinkOp;
	id: number;
}

/** The reservation fields the link decision reads, whichever kind it is. */
interface LinkableRow {
	itineraryId: number | null;
	status: string;
	price: number;
}

/**
 * Read both reservations the request names, in one round trip.
 *
 * `Promise.all` over independent primary-key lookups is a single batch on one
 * connection, and it keeps the price the total is built from and the ownership
 * and status the response depends on coming from the same rows.
 *
 * Only the two conditions a claim cannot re-derive are decided here: a row that
 * is absent (404) and a row that belongs to someone else (403). Whether the
 * reservation is cancelled or already attached is re-checked at claim time,
 * because between this read and that claim another request may have linked it.
 */
async function readRequestedReservations(
	userId: number,
	requests: readonly LinkRequest[]
): Promise<LinkableRow[]> {
	return Promise.all(
		requests.map(async ({ op, id }): Promise<LinkableRow> => {
			/*
			 * The two delegates are branched on rather than selected by name: indexing
			 * `prisma` with a variable keys the result as a union of two delegates whose
			 * call signatures are unrelated, which TypeScript rejects as uncallable.
			 */
			const row =
				op.kind === FLIGHT_OP.kind
					? await prisma.flightReservation.findUnique({
							where: { id },
							select: { userId: true, itineraryId: true, status: true, price: true },
						})
					: await prisma.hotelReservation.findUnique({
							where: { id },
							select: { userId: true, itineraryId: true, status: true, price: true },
						});

			if (row === null) {
				throw new ReservationNotLinkable(
					notFound(`${op.label} reservation not found`)
				);
			}
			if (row.userId !== userId) {
				throw new ReservationNotLinkable(
					forbidden(`Unauthorized ${op.kind} reservation access`)
				);
			}
			return row;
		})
	);
}

/**
 * Attach one reservation to an itinerary, or nothing at all.
 *
 * The claim is a conditional `updateMany` on `itineraryId: null`. The column is
 * `@unique`, which stops two rows from sharing a value; it does not stop one row's
 * value from being overwritten, so an unconditional `update` guarded only by a
 * pre-read would let a second request steal a reservation that the first had just
 * linked. Matching zero rows is therefore the concurrency signal, and it is
 * read as "already linked" — the same answer a pre-read gives for a reservation
 * another request attached, which is why the pre-read does not have to.
 *
 * @throws ReservationNotLinkable when the claim matches nothing: the reservation
 *   was cancelled or attached to another itinerary since it was read.
 */
async function linkReservation(
	tx: Prisma.TransactionClient,
	{ op, id }: LinkRequest,
	itineraryId: number,
	status: string
): Promise<void> {
	if (status === "CANCELLED") {
		throw new ReservationNotLinkable(
			conflict(`${op.label} reservation is cancelled`)
		);
	}

	const claimed =
		op.kind === FLIGHT_OP.kind
			? await tx.flightReservation.updateMany({
					where: { id, itineraryId: null },
					data: { itineraryId },
				})
			: await tx.hotelReservation.updateMany({
					where: { id, itineraryId: null },
					data: { itineraryId },
				});
	if (claimed.count === 0) {
		throw new ReservationNotLinkable(
			conflict(`${op.label} reservation already linked`)
		);
	}
}

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");
	const body = await parseJsonBody(request);

	// Both ids are optional, and the client explicitly sends `null` for the one
	// it is not using. `readId` accepts `5` and `"5"` alike; anything that is not
	// a positive integer is a `400`.
	const flightReservationId = readId(body, "flightReservationId");
	const hotelReservationId = readId(body, "hotelReservationId");
	if (flightReservationId === undefined && hotelReservationId === undefined) {
		// Neither id was supplied, so nothing was addressed — an omitted input is a
		// `400`, not a missing resource. The client renders the message verbatim.
		throw badRequest("No reservations provided for the itinerary");
	}

	// One id was given, so there is exactly one reservation per kind at most.
	const requests: LinkRequest[] = [];
	if (flightReservationId !== undefined) {
		requests.push({ op: FLIGHT_OP, id: flightReservationId });
	}
	if (hotelReservationId !== undefined) {
		requests.push({ op: HOTEL_OP, id: hotelReservationId });
	}

	try {
		/*
		 * Everything that can be decided without holding a transaction — that both
		 * rows exist, belong to the caller, and what they cost — is decided here,
		 * in one batched read. Only the conditional claims are left for the
		 * transaction, which is what keeps its duration independent of the number
		 * of round trips a cold connection needs.
		 */
		const rows = await readRequestedReservations(userId, requests);
		const totalPrice = rows.reduce((sum, row) => sum + row.price, 0);

		const itinerary = await prisma.$transaction(async (tx) => {
				const created = await tx.itinerary.create({
					data: {
						userId,
						totalPrice,
						status: "DRAFT",
						cardNumber: "",
						cardExpiry: "",
					},
					select: { id: true, status: true },
				});

				const linked: {
					flight: { id: number } | false;
					hotel: { id: number } | false;
				} = { flight: false, hotel: false };

				// Sequential, not `Promise.all`: the two claims are the statements that
				// can contend with a concurrent request, and a transaction runs them on
				// its one connection anyway.
				for (const [index, request] of requests.entries()) {
					await linkReservation(
						tx,
						request,
						created.id,
						rows[index]?.status ?? ""
					);
					linked[request.op.kind] = { id: request.id };
				}

				// Removing a booking later notifies the owner; the traveller learns
				// about their own new itinerary here, never twice.
				await tx.notification.create({
					data: {
						userId,
						content: `Your itinerary (ID: ${created.id}) has been created successfully.`,
					},
				});

				/*
				 * The response is assembled from the rows the transaction just wrote
				 * rather than re-read through `tx.itinerary.findUnique`. A re-read costs
				 * another round trip inside the timeout budget and can only agree with
				 * what is already known: the claims committed at `itineraryId: null`, so
				 * both relations point at this itinerary by construction.
				 */
				return {
					id: created.id,
					status: created.status,
					flight: linked.flight,
					hotel: linked.hotel,
				};
			},
			// The shared budget: this transaction holds a connection across four
			// statements, one of which may queue behind a concurrent claim.
			DEFAULT_TRANSACTION_OPTIONS
		);

		return jsonCreated({
			message: "Itinerary created successfully",
			reservations: itinerary,
		});
	} catch (error) {
		if (error instanceof ReservationNotLinkable) {
			throw error.apiError;
		}
		throw error;
	}
});
