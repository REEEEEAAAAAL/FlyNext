/**
 * `GET  /api/notifications` — list the caller's notifications.
 * `POST /api/notifications` — record a notification for the caller.
 *
 * Response contract, relied on by `app/notifications/page.tsx`:
 * - `200 { notifications: NotificationDto[] }`
 * - `201 { notification: NotificationDto }`
 * - `400 { error: "Missing content in request body" }`
 * - `401 { error: "Unauthorized" }`
 * - `429 { error: string }`
 *
 * The list is capped. Notifications accumulate for the life of an account and the
 * page renders a plain list, so an uncapped `findMany` grows without bound; the
 * newest 100 are returned.
 */

import { requireAuth } from "@/lib/api/auth";
import { badRequest } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonCreated, jsonOk } from "@/lib/api/response";
import { parseJsonBody, readString } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

/** Most notifications returned by one listing request. */
const MAX_NOTIFICATIONS = 100;

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "notificationRead");

	const notifications = await prisma.notification.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: MAX_NOTIFICATIONS,
	});

	return jsonOk({ notifications });
});

export const POST = withRoute(async (request) => {
	const { userId } = requireAuth(request);
	enforceRateLimit(request, "bookingWrite");

	const body = await parseJsonBody(request);
	const content = readString(body, "content", { maxLength: 1000 });
	if (content === undefined) {
		throw badRequest("Missing content in request body");
	}

	const notification = await prisma.notification.create({
		data: { userId, content },
	});

	return jsonCreated({ notification });
});
