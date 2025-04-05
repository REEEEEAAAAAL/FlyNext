import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(request) {
  try {
    const currentUser = await verifyToken(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get count of unread notifications for the authenticated user
    const unreadCount = await prisma.notification.count({
      where: {
        userId: currentUser.userId, 
        isRead: false,
      },
    });

    return NextResponse.json({ unreadCount });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to retrieve unread notifications" },
      { status: 500 }
    );
  }
}
