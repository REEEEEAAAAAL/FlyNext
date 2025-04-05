import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { cancelFlight } from "@/lib/afs-client";

// GET: Retrieve details of a specific itinerary
export async function GET(request, { params }) {
    try {
        // Authenticate user and extract user identifier
        const currentUser = await verifyToken(request);
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }
        const userId = currentUser.userId || currentUser.id;
        if (!userId) {
            return NextResponse.json(
                { error: "Invalid user identifier" },
                { status: 400 }
            );
        }

        // Convert itineraryId to number and validate
        const resolvedParams = await params;
        const itineraryId = Number(resolvedParams.itineraryId);
        if (isNaN(itineraryId)) {
            return NextResponse.json(
                { error: "Invalid itinerary ID" },
                { status: 400 }
            );
        }

        // Retrieve the itinerary ensuring it belongs to the current user
        const itinerary = await prisma.itinerary.findFirst({
            where: { id: itineraryId, userId: userId },
            select: {
                id: true,
                flight: {
                    select: {
                        id: true,
                        // Do not include scalar fields like afsBookingId explicitly.
                        departure: true,
                        arrival: true,
                        price: true,
                        status: true,
                    },
                },
                hotel: {
                    select: {
                        id: true,
                        hotel: {
                            select: {
                                name: true,
                                address: true,
                                location: true,
                            },
                        },
                        roomType: {
                            select: {
                                name: true,
                            },
                        },
                        checkIn: true,
                        checkOut: true,
                        price: true,
                        status: true,
                    },
                },
                totalPrice: true,
                bookingDate: true,
                status: true,
            },
        });
        if (!itinerary) {
            return NextResponse.json(
                { error: "You do not have access to this itinerary" },
                { status: 403 }
            );
        }
        return NextResponse.json(itinerary, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            { error: error.message || "Server error" },
            { status: 500 }
        );
    }
}

// DELETE: Cancel a specific itinerary and its related bookings
export async function DELETE(request, { params }) {
    try {
        // Authenticate user and extract user identifier
        const currentUser = await verifyToken(request);
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }
        const userId = currentUser.userId || currentUser.id;
        if (!userId) {
            return NextResponse.json(
                { error: "Invalid user identifier" },
                { status: 400 }
            );
        }

        // Convert itineraryId to number and validate
        const resolvedParams = await params;
        const itineraryId = Number(resolvedParams.itineraryId);
        if (isNaN(itineraryId)) {
            return NextResponse.json(
                { error: "Invalid itinerary ID" },
                { status: 400 }
            );
        }

        // Verify the itinerary belongs to the current user using composite conditions
        const itinerary = await prisma.itinerary.findFirst({
            where: { id: itineraryId, userId: userId },
            include: { flight: true, hotel: true },
        });
        if (!itinerary) {
            return NextResponse.json(
                { error: "You do not have access to this itinerary" },
                { status: 403 }
            );
        }

        // Handle flight cancellation if a flight reservation exists
        if (itinerary.flight) {
            const flightReservation = await prisma.flightReservation.findUnique(
                {
                    where: { id: itinerary.flight.id },
                }
            );
            if (!flightReservation) {
                return NextResponse.json(
                    { error: "Flight reservation not found" },
                    { status: 404 }
                );
            }
            if (flightReservation.status === "CONFIRMED") {
                // find the last name of the user
                const user = await prisma.user.findUnique({
                    where: { id: currentUser.userId },
                    select: { lastName: true },
                });
                // Cancel the flight booking via AFS API
                const cancellation = await cancelFlight(
                    flightReservation.afsBookingId,
                    user.lastName
                );
                if (cancellation.status === "CANCELLED") {
                    await prisma.flightReservation.update({
                        where: { id: flightReservation.id },
                        data: { status: "CANCELLED" },
                    });
                } else {
                    return NextResponse.json(
                        { error: "Flight cancellation failed" },
                        { status: 500 }
                    );
                }
            }
        }

        // Handle hotel cancellation if a hotel reservation exists
        if (itinerary.hotel) {
            const hotelReservation = await prisma.hotelReservation.findUnique({
                where: { id: itinerary.hotel.id },
            });
            if (!hotelReservation) {
                return NextResponse.json(
                    { error: "Hotel booking not found" },
                    { status: 404 }
                );
            }
            await prisma.hotelReservation.update({
                where: { id: hotelReservation.id },
                data: { status: "CANCELLED" },
            });

            // Update the room availablity
            const roomTypeId = hotelReservation.roomTypeId;
            const roomType = await prisma.roomType.findUnique({
                where: { id: Number(roomTypeId) },
            });
            if (!roomType) {
                return NextResponse.json(
                    { error: "Room type not found" },
                    { status: 404 }
                );
            }
            await prisma.roomType.update({
                where: { id: Number(roomTypeId) },
                data: { currentAvailability: { increment: 1 } },
            });
        }

        // Update the itinerary
        await prisma.itinerary.update({
            where: { id: itineraryId },
            data: {
                status: "CANCELLED",
                totalPrice: 0,
            },
        });

        return NextResponse.json(
            {
                message:
                    "Itinerary and all related bookings canceled successfully",
            },
            { status: 200 }
        );
    } catch (error) {
        return NextResponse.json(
            { error: error.message || "Cancellation failed" },
            { status: 500 }
        );
    }
}
