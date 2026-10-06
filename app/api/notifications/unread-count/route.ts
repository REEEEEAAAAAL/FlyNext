/**
 * `GET /api/notifications/unread-count` — badge count for the navigation bar.
 *
 * Response contract, relied on by `app/components/NotificationBadge.tsx`, which
 * polls this endpoint every 5 seconds for as long as the nav bar is mounted:
 * - `200 { unreadCount: number }`
 * - `401 { error: "Unauthorized" }`
 * - `429 { error: string }` with `Retry-After`, which the badge honours
 *
 * Because it is polled, two things matter more here than anywhere else: the
 * handler is a single indexed `count` and nothing else, and each caller has a
 * budget several times the intended poll rate, so a client whose timer has gone
 * wrong cannot turn into a permanent query stream against the database.
 */

import { requireAuth } from "@/lib/api/auth";
import { withRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export const GET = withRoute(async (request) => {
	const { userId } = requireAuth(request);

	// The badge polls this endpoint on a timer, so a tab that has lost its network
	// or is running a broken loop can otherwise turn into a permanent query stream
	// against the database. The budget is several times the intended poll rate.
	enforceRateLimit(request, "notificationPoll");

	const unreadCount = await prisma.notification.count({
		where: { userId, isRead: false },
	});

	return jsonOk({ unreadCount });
});
