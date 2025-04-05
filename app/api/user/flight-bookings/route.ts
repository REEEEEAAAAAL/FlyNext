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

        const bookings = await prisma.flightReservation.findMany({
            where: { userId: parseInt(currentUser.userId) },
            select: {
                id: true,
                afsBookingId: true,
                departure: true,
                arrival: true,
                price: true,
                status: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json({
            bookings: bookings.map((b: any) => ({
                id: b.id,
                status: b.status,
                afsBookingId: b.afsBookingId,
                price: b.price,
                departure: {
                    goDate: b.departure.goDate ? b.departure.goDate : " ",
                    returnDate: b.departure.returnDate
                        ? b.departure.returnDate
                        : " ",
                    goAirport: b.departure.goAirport
                        ? b.departure.goAirport
                        : " ",
                    returnAirport: b.departure.returnAirport
                        ? b.departure.returnAirport
                        : " ",
                },
                arrival: {
                    goDate: b.arrival.goDate ? b.arrival.goDate : " ",
                    returnDate: b.arrival.returnDate
                        ? b.arrival.returnDate
                        : " ",
                    goAirport: b.arrival.goAirport ? b.arrival.goAirport : " ",
                    returnAirport: b.arrival.returnAirport
                        ? b.arrival.returnAirport
                        : " ",
                },
                createdAt: b.createdAt,
            })),
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch flight bookings" },
            { status: 500 }
        );
    }
}
