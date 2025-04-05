import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";


export async function GET(request : NextRequest) {
  try {
    const currentUser = await verifyToken(request) as JwtPayload | null;
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
      { error: (error as Error).message || "Failed to retrieve unread notifications" },
      { status: 500 }
    );
  }
}
