import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

/**
 * Marks every unread notification for the authenticated account in one write,
 * including notifications omitted by the list limit. A repeat returns zero
 * unless new unread notifications have arrived.
 */
export const PUT = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	await enforceRateLimit(request, "bookingWrite");

	const { count } = await prisma.notification.updateMany({
		where: { userId, isRead: false },
		data: { isRead: true },
	});

	return jsonOk({ updatedCount: count });
});
