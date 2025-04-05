import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { verifyFlight, cancelFlight } from "@/lib/afs-client";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function GET(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    try {
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { bookingId } = await params;
        const booking = (await prisma.flightReservation.findUnique({
            where: {
                id: parseInt(bookingId),
                userId: parseInt(currentUser.userId),
            },
            select: {
                id: true,
                afsBookingId: true,
                departure: true,
                arrival: true,
                price: true,
                status: true,
                createdAt: true,
                itineraryId: true,
            },
        })) as any;

        if (!booking) {
            return NextResponse.json(
                { error: "Booking not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            booking: {
                ...booking,
                departure: {
                    goDate: booking.departure.goDate
                        ? booking.departure.goDate
                        : " ",
                    goAirport: booking.departure.goAirport
                        ? booking.departure.goAirport
                        : " ",
                    returnDate: booking.departure.returnDate
                        ? booking.departure.returnDate
                        : " ",
                    returnAirport: booking.departure.returnAirport
                        ? booking.departure.returnAirport
                        : " ",
                },
                arrival: {
                    goDate: booking.arrival.goDate
                        ? booking.arrival.goDate
                        : " ",
                    goAirport: booking.arrival.goAirport
                        ? booking.arrival.goAirport
                        : " ",
                    returnDate: booking.arrival.returnDate
                        ? booking.arrival.returnDate
                        : " ",
                    returnAirport: booking.arrival.returnAirport
                        ? booking.arrival.returnAirport
                        : " ",
                },
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch flight booking details" },
            { status: 500 }
        );
    }
}

// Verify the flight booking status
export async function POST(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    try {
        // Authentication check
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { bookingId } = await params;
        const flightReservation = await prisma.flightReservation.findUnique({
            where: {
                id: parseInt(bookingId),
                userId: parseInt(currentUser.userId),
            },
            select: {
                id: true,
                afsBookingId: true,
                departure: true,
                arrival: true,
                price: true,
                status: true,
                createdAt: true,
                itineraryId: true,
            },
        });

        if (!flightReservation) {
            return NextResponse.json(
                { error: "Booking not found" },
                { status: 404 }
            );
        }

        // find the last name of the user
        const user = await prisma.user.findUnique({
            where: { id: currentUser.userId },
            select: { lastName: true },
        });
        if (!user) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }
        // Call AFS API to verify flight status
        const verification = (await verifyFlight(
            flightReservation.afsBookingId,
            user.lastName
        )) as any;
        if (
            verification.status === "CONFIRMED" &&
            verification.flights?.[0]?.status === "SCHEDULED" &&
            (!verification.flights[1] ||
                verification.flights?.[1]?.status === "SCHEDULED")
        ) {
            return NextResponse.json(
                { message: "Flight is on schedule" },
                { status: 200 }
            );
        } else {
            return NextResponse.json(
                {
                    message:
                        "Flight is " +
                        (verification.flights
                            ? verification.flights.status
                            : "unknown"),
                },
                { status: 500 }
            );
        }
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message || "Verification failed" },
            { status: 500 }
        );
    }
}

// DELETE: Cancel the flight booking
export async function DELETE(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    try {
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { bookingId } = await params;
        const flightReservation = await prisma.flightReservation.findUnique({
            where: {
                id: parseInt(bookingId),
                userId: parseInt(currentUser.userId),
            },
            select: {
                id: true,
                afsBookingId: true,
                departure: true,
                arrival: true,
                price: true,
                status: true,
                createdAt: true,
                itineraryId: true,
            },
        });

        if (!flightReservation) {
            return NextResponse.json(
                { error: "Booking not found" },
                { status: 404 }
            );
        }

        if (flightReservation.status === "CONFIRMED") {
            // find the last name of the user
            const user = await prisma.user.findUnique({
                where: { id: currentUser.userId },
                select: { lastName: true },
            });
            if (!user) {
                return NextResponse.json(
                    { error: "User not found" },
                    { status: 404 }
                );
            }
            // Cancel the flight booking via AFS API
            const cancellation = await cancelFlight(
                flightReservation.afsBookingId,
                user.lastName
            );
            if (cancellation.status === "CANCELLED") {
                // Update flight reservation status using its unique id
                await prisma.flightReservation.update({
                    where: { id: flightReservation.id },
                    data: { status: "CANCELLED" },
                });

                if (flightReservation.itineraryId) {
                    // Update itinerary totalPrice by decrementing the flight price
                    try {
                        await prisma.itinerary.update({
                            where: { id: flightReservation.itineraryId },
                            data: {
                                totalPrice: {
                                    decrement: flightReservation.price,
                                },
                            },
                        });
                    } catch (error) {
                        console.log("Error updating itinerary:", error);
                    }
                }

                return NextResponse.json(
                    {
                        message: "Flight booking cancelled successfully",
                    },
                    { status: 200 }
                );
            } else {
                return NextResponse.json(
                    { error: "Flight booking cancellation failed" },
                    { status: 500 }
                );
            }
        } else {
            return NextResponse.json(
                { message: "Flight booking is already cancelled" },
                { status: 200 }
            );
        }
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}
