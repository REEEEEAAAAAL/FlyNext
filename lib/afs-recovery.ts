import axios, { type AxiosResponse } from "axios";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createBooking, cancelFlight, isAfsOffline } from "./afs-client";
import { resolveAfsMode } from "./afs/config";
import { recoverBooking } from "./afs/offline";
import { createFlightReservation, cancelFlightReservation, resumeItineraryCancellation } from "./reservations";
import { ApiError, ProviderBookingRejected, badGateway } from "./api/errors";
import type { AfsCreateBookingRequest } from "../types";

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function finish(id: string, message: string) {
	await prisma.bookingRequest.updateMany({ where: { id, state: { in: ["PENDING", "COMPENSATING"] } },
		data: { state: "COMPLETE", statusCode: 502, response: { error: message } } });
}

export async function reconcileFlightRequest(id: string): Promise<void> {
	const request = await prisma.bookingRequest.findUniqueOrThrow({ where: { id } });
	if (request.state === "COMPLETE" || request.scope !== "flight-book" || !record(request.recovery)) return;
	const value = request.recovery.payload;
	if (!record(value) || typeof value.firstName !== "string" || typeof value.lastName !== "string" || typeof value.email !== "string" || typeof value.passportNumber !== "string" || !Array.isArray(value.flightIds) || !value.flightIds.every((item): item is string => typeof item === "string")) return;
	const payload: AfsCreateBookingRequest = { firstName: value.firstName, lastName: value.lastName, email: value.email, passportNumber: `DEMO-${id}`, flightIds: value.flightIds };
	try {
		let issued;
		if (isAfsOffline()) {
			issued = await recoverBooking(id);
			if (!issued) issued = await createBooking(payload, id);
		} else {
			const mode = resolveAfsMode();
			if (mode.mode !== "remote" || !mode.baseUrl || !process.env.AFS_API_KEY) return;
			// The agency-scoped lookup distinguishes an absent ticket from a lost response.
			let data: unknown = null;
			try {
				const response: AxiosResponse<unknown> = await axios.get(mode.baseUrl + "/api/bookings/retrieve", { params: { operationKey: id }, headers: { "x-api-key": process.env.AFS_API_KEY }, timeout: 15000, validateStatus: status => status === 200 || status === 404 });
				if (response.headers["x-afs-booking-protocol"] !== "1") throw badGateway("Provider does not support safe booking recovery");
				if (response.status === 404 && request.state === "COMPENSATING") { await finish(id, "Booking failed and the ticket has been released"); return; }
				data = response.data;
			} catch (error) {
				if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
				if (request.state === "COMPENSATING") { await finish(id, "Booking failed and the ticket has been released"); return; }
			}
			if (record(data) && data.status === "CANCELLED") { await finish(id, "Booking failed and the ticket has been released"); return; }
			// Replaying the durable provider key can never issue a second ticket.
			issued = await createBooking(payload, id);
		}
		if (request.state === "COMPENSATING") {
			await cancelFlight(issued.id ?? issued.bookingReference, payload.lastName);
			await finish(id, "Booking failed and the ticket has been released");
			return;
		}
		await createFlightReservation(payload, request.userId, { operationId: id,
			returnLegCount: typeof request.recovery.returnLegCount === "number" ? request.recovery.returnLegCount : undefined,
			createBooking: async () => issued });
	} catch (error) {
		if (error instanceof ProviderBookingRejected || (error instanceof ApiError && error.message.includes("ticket has been released"))) { await finish(id, error.message); return; }
		throw error;
	}
}

export async function reconcileFlights(): Promise<void> {
	const requests = await prisma.bookingRequest.findMany({ where: { scope: "flight-book", state: { in: ["PENDING", "COMPENSATING"] }, recovery: { not: Prisma.DbNull }, createdAt: { lt: new Date(Date.now() - 30000) } }, orderBy: { createdAt: "asc" }, take: 100 });
	for (const request of requests) {
		try { await reconcileFlightRequest(request.id); }
		catch { console.error("[afs] reconciliation will retry", request.id); }
	}
	const cancellations = await prisma.flightReservation.findMany({ where: { cancellationPending: true, status: "CONFIRMED" }, take: 100 });
	for (const reservation of cancellations) {
		try { await cancelFlightReservation(reservation.id); }
		catch { console.error("[afs] cancellation will retry", reservation.id); }
	}
	const trips = await prisma.itinerary.findMany({ where: { cancellationRequested: true, status: { not: "CANCELLED" } }, take: 100 });
	for (const trip of trips) {
		try { await resumeItineraryCancellation(trip.id, trip.userId); }
		catch { console.error("[afs] itinerary cancellation will retry", trip.id); }
	}
}
