import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { idempotentWrite } from "@/lib/api/idempotency";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody, readId } from "@/lib/api/validation";
import { lockTraveller, money } from "@/lib/booking-locks";

export const POST = withRoute(async request => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "checkout");
	const body = await parseJsonBody(request);
	const itineraryId = readId(body, "itineraryId");
	if (itineraryId === undefined || body.paymentMethod !== "DEMO") throw badRequest("An itineraryId and DEMO paymentMethod are required");
	if (Object.keys(body).some(key => !["itineraryId", "paymentMethod"].includes(key))) throw badRequest("Demo checkout does not accept card or identity details");
	return idempotentWrite(request, userId, "checkout", body, async tx => {
		await lockTraveller(tx, userId);
		await tx.$queryRaw`SELECT id FROM "Itinerary" WHERE id = ${itineraryId} FOR UPDATE`;
		const order = await tx.itinerary.findFirst({ where: { id: itineraryId, userId }, include: { flight: true, hotel: true } });
		if (!order) throw notFound("Itinerary not found or access denied");
		if (order.status === "CANCELLED" || order.cancellationRequested) throw conflict("This itinerary has been cancelled or cancellation is pending");
		if (order.status === "CONFIRMED") {
			if (order.confirmationTotal === null || order.confirmedAt === null) throw conflict("Historical confirmation snapshot is unavailable; review the existing itinerary");
			return { status: 200, body: { message: "Checkout successful", itinerary: confirmation(order) } };
		}
		const active = [order.flight, order.hotel].filter(row => row?.status === "CONFIRMED");
		if (!active.length || order.flight?.cancellationPending) throw conflict("No active reservations or a cancellation is pending");
		const total = money(active.reduce((sum, row) => sum + row!.price, 0));
		const claimed = await tx.itinerary.updateMany({ where: { id: itineraryId, userId, status: "DRAFT", cancellationRequested: false }, data: { status: "CONFIRMED", paymentMethod: "DEMO", confirmationTotal: total, confirmedAt: new Date(), totalPrice: total } });
		if (claimed.count !== 1) throw conflict("Checkout state changed; reload the itinerary");
		const updated = await tx.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
		return { status: 200, body: { message: "Checkout successful", itinerary: confirmation(updated) } };
	});
});

function confirmation(order: { id: number; status: string; confirmationTotal: number | null; totalPrice: number; confirmedAt: Date | null; bookingDate: Date; paymentMethod: string | null }) {
	return { id: order.id, status: order.status, totalPrice: order.confirmationTotal ?? order.totalPrice, bookingDate: order.bookingDate, confirmedAt: order.confirmedAt, paymentMethod: order.paymentMethod, currency: "USD" };
}
