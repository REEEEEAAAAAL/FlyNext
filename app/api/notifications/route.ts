import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// Retrieve notifications for the authenticated user
export async function GET(request: NextRequest) {
    try {
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const notifications = await prisma.notification.findMany({
            where: { userId: currentUser.userId },
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json({ notifications });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    (error as Error).message ||
                    "Failed to retrieve notifications",
            },
            { status: 500 }
        );
    }
}

// Create a new notification for the authenticated user
export async function POST(request: NextRequest) {
    try {
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = currentUser.userId;
        if (!userId) {
            return NextResponse.json(
                { error: "Invalid user identifier" },
                { status: 400 }
            );
        }

        const { content } = await request.json();
        if (!content) {
            return NextResponse.json(
                { error: "Missing content in request body" },
                { status: 400 }
            );
        }

        const notification = await prisma.notification.create({
            data: {
                user: { connect: { id: userId } },
                content,
                // isRead defaults to false and createdAt defaults to now in the schema
            },
        });

        return NextResponse.json({ notification }, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    (error as Error).message || "Failed to create notification",
            },
            { status: 500 }
        );
    }
}
