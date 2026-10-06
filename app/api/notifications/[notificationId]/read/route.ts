/**
 * `PUT /api/notifications/[notificationId]/read` — mark one notification read.
 *
 * Response contract, relied on by `app/notifications/page.tsx`:
 * - `200 { notification: NotificationDto }`
 * - `401 { error: "Unauthorized" }`
 * - `404 { error: string }` — the row is missing, or belongs to somebody else
 *
 * The write is a single `updateMany` scoped by `userId`, so the ownership test and
 * the mutation are the same statement: there is no read-then-write window, and a
 * caller cannot flip the `isRead` flag on another user's notification by iterating
 * ids. Reporting both "not yours" and "does not exist" as `404` means the caller
 * learns nothing about which ids are taken.
 */

import { requireAuth } from "@/lib/api/auth";
import { notFound } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { parseRouteId } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";

export const PUT = withRoute<{ notificationId: string }>(
	async (request, context) => {
		const { userId } = requireAuth(request);
		const { notificationId: rawNotificationId } = await context.params;
		const notificationId = parseRouteId(rawNotificationId, "notificationId");

		// `updateMany` scopes the write to the caller in the same statement that
		// performs it, so there is no read-then-write window.
		const updated = await prisma.notification.updateMany({
			where: { id: notificationId, userId },
			data: { isRead: true },
		});
		if (updated.count === 0) {
			throw notFound("Notification not found");
		}

		const notification = await prisma.notification.findUnique({
			where: { id: notificationId },
		});

		return jsonOk({ notification });
	}
);
