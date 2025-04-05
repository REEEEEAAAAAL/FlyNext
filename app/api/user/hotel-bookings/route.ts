import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const bookings = await prisma.hotelReservation.findMany({
            where: { userId: parseInt(currentUser.userId) },
            select: {
                id: true,
                checkIn: true,
                checkOut: true,
                price: true,
                status: true,
                hotel: {
                    select: {
                        name: true,
                        address: true,
                        location: true,
                    },
                },
                roomType: { select: { name: true, amenities: true } },
                createdAt: true,
            },
            orderBy: { checkIn: "desc" },
        });

        return NextResponse.json({
            bookings: bookings.map((b: any) => ({
                id: b.id,
                status: b.status,
                period: {
                    checkIn: b.checkIn,
                    checkOut: b.checkOut,
                },
                hotel: {
                    name: b.hotel.name,
                    address: b.hotel.address,
                    location: b.hotel.location,
                },
                roomType: {
                    name: b.roomType.name,
                    amenities: b.roomType.amenities,
                },
                totalPrice: b.price,
                createdAt: b.createdAt,
            })),
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch hotel bookings" },
            { status: 500 }
        );
    }
}
