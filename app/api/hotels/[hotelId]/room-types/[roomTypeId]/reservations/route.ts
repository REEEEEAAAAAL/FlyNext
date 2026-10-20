import { requireAuth } from "@/lib/api/auth";
import { forbidden, notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import type { RoomTypeReservationDto } from "@/types";

/** Guest information is available only to the room's current hotel owner. */
export const GET = withRoute<{ hotelId: string; roomTypeId: string }>(async (request, context) => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "profileRead");
	const params = await context.params;
	const hotelId = parseRouteId(params.hotelId, "hotelId");
	const roomTypeId = parseRouteId(params.roomTypeId, "roomTypeId");
	const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { ownerId: true } });
	if (!hotel) throw notFound("Hotel not found");
	if (hotel.ownerId !== userId) throw forbidden("Forbidden");
	const room = await prisma.roomType.findFirst({ where: { id: roomTypeId, hotelId }, select: { id: true } });
	if (!room) throw notFound("Room type not found");
	const rows = await prisma.hotelReservation.findMany({
		where: { roomTypeId, hotelId, hotel: { ownerId: userId } },
		select: { id: true, userId: true, checkIn: true, checkOut: true, price: true, status: true,
			user: { select: { firstName: true, lastName: true } } },
		orderBy: { checkIn: "asc" },
	});
	const reservations: RoomTypeReservationDto[] = rows.map(({ user, ...row }) => ({
		...row, guestName: `${user.firstName} ${user.lastName}`.trim(),
	}));
	const response = jsonOk({ reservations });
	response.headers.set("Cache-Control", "private, no-store");
	return response;
});
