import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { verifyFlight, cancelFlight } from "@/lib/afs-client";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// GET: Verify the flight booking status
export async function GET(
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

        // Convert itineraryId to a number
        const resolvedParams = await params;
        const itineraryId = Number(resolvedParams.itineraryId);
        if (isNaN(itineraryId)) {
            return NextResponse.json(
                { error: "Invalid itinerary ID" },
                { status: 400 }
            );
        }

        // Verify the itinerary belongs to the current user using findFirst with composite condition
        const itinerary = (await prisma.itinerary.findFirst({
            where: {
                id: itineraryId,
                userId: currentUser.userId || currentUser.id,
            },
            select: { flight: true },
        })) as { flight: { id: number } };
        if (!itinerary) {
            return NextResponse.json(
                { error: "You do not have access to this itinerary" },
                { status: 403 }
            );
        }

        // Retrieve the flight reservation using the unique flight id
        const flightReservation = await prisma.flightReservation.findFirst({
            where: {
                id: itinerary.flight.id,
                userId: currentUser.userId || currentUser.id,
            },
        });
        if (!flightReservation) {
            return NextResponse.json(
                { error: "Flight reservation not found" },
                { status: 404 }
            );
        }

        // find the last name of the user
        const user = (await prisma.user.findUnique({
            where: { id: currentUser.userId },
            select: { lastName: true },
        })) as { lastName: string };
        // Call AFS API to verify flight status
        const verification = (await verifyFlight(
            flightReservation.afsBookingId,
            user.lastName
        )) as any;
        // Assuming verification.flights is an object with a status property
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

        // Convert itineraryId to a number
        const resolvedParams = await params;
        const itineraryId = Number(resolvedParams.itineraryId);
        if (isNaN(itineraryId)) {
            return NextResponse.json(
                { error: "Invalid itinerary ID" },
                { status: 400 }
            );
        }

        // Verify the itinerary belongs to the current user
        const itinerary = (await prisma.itinerary.findFirst({
            where: {
                id: itineraryId,
                userId: currentUser.userId || currentUser.id,
            },
            select: { flight: true },
        })) as any;
        if (!itinerary) {
            return NextResponse.json(
                { error: "You do not have access to this booking" },
                { status: 403 }
            );
        }

        // Retrieve the flight reservation
        const flightReservation = await prisma.flightReservation.findFirst({
            where: {
                id: itinerary.flight.id,
                userId: currentUser.userId || currentUser.id,
            },
        });
        if (!flightReservation) {
            return NextResponse.json(
                { error: "Flight reservation not found" },
                { status: 404 }
            );
        }

        if (flightReservation.status === "CONFIRMED") {
            // find the last name of the user
            const user = (await prisma.user.findUnique({
                where: { id: currentUser.userId },
                select: { lastName: true },
            })) as { lastName: string };
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
                // Update itinerary totalPrice by decrementing the flight price
                await prisma.itinerary.update({
                    where: { id: itineraryId },
                    data: {
                        totalPrice: { decrement: flightReservation.price },
                    },
                });
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
