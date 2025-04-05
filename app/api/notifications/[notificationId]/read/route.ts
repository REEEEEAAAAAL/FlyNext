import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function PUT(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    try {
        const currentUser = await verifyToken(request) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }
        const { notificationId } = await params;
        const notification = await prisma.notification.update({
            where: {
                id: Number(notificationId),
            },
            data: {
                isRead: true,
            },
        });
        return NextResponse.json({ notification });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    (error as Error).message ||
                    "Notification ID not found or failed to read notification",
            },
            { status: 500 }
        );
    }
}
