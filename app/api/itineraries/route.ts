import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// GET /api/itineraries
export async function GET(request: NextRequest) {
    try {
        // Authenticate and extract the user identifier
        const currentUser = await verifyToken(request) as JwtPayload | null;
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

        // Fetch itineraries for the authenticated user.
        // For Flight, we return all scalar fields by setting flight: true.
        const itineraries = await prisma.itinerary.findMany({
            where: { userId: userId },
            select: {
                id: true,
                flight: true, // returns all scalar fields (including departure, arrival, etc.)
                hotel: {
                    select: {
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
            orderBy: { bookingDate: "desc" },
        });
        return NextResponse.json({ itineraries }, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    (error as Error).message ||
                    "Failed to retrieve itineraries",
            },
            { status: 500 }
        );
    }
}

export async function POST(request : NextRequest) {
    try {
        const currentUser = await verifyToken(request) as JwtPayload | null;
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

        // Expecting initial reservation IDs in the request body
        const { flightReservationId, hotelReservationId } =
            await request.json();

        const result = await prisma.$transaction(async (prisma) => {
            const [flightReservation, hotelReservation] = await Promise.all([
                flightReservationId
                    ? prisma.flightReservation.findUnique({
                          where: { id: Number(flightReservationId) },
                          select: {
                              userId: true,
                              itineraryId: true,
                              price: true,
                          },
                      })
                    : null,
                hotelReservationId
                    ? prisma.hotelReservation.findUnique({
                          where: { id: Number(hotelReservationId) },
                          select: {
                              userId: true,
                              itineraryId: true,
                              price: true,
                              hotelId: true,
                          },
                      })
                    : null,
            ]);

            // Verify flight reservation if provided
            if (flightReservationId) {
                if (!flightReservation) {
                    throw new Error("Flight reservation not found");
                }
                if (flightReservation.userId !== userId) {
                    throw new Error("Unauthorized flight reservation access");
                }
                if (flightReservation.itineraryId) {
                    throw new Error("Flight reservation already linked");
                }
            }

            // Verify hotel reservation if provided
            if (hotelReservationId) {
                if (!hotelReservation) {
                    throw new Error("Hotel reservation not found");
                }
                if (hotelReservation.userId !== userId) {
                    throw new Error("Unauthorized hotel reservation access");
                }
                if (hotelReservation.itineraryId) {
                    throw new Error("Hotel reservation already linked");
                }
            }

            // Calculate total price from available reservations
            const totalPrice =
                (hotelReservation ? hotelReservation.price : 0) +
                (flightReservation ? flightReservation.price : 0);

            // Create itinerary record with status "DRAFT" and empty card info.
            const itinerary = await prisma.itinerary.create({
                data: {
                    userId: userId,
                    totalPrice: totalPrice,
                    status: "DRAFT",
                    cardNumber: "",
                    cardExpiry: "",
                },
            });

            // Update reservations with the new itinerary id.
            const updatePromises = [];
            if (flightReservationId) {
                updatePromises.push(
                    prisma.flightReservation.update({
                        where: { id: Number(flightReservationId) },
                        data: { itineraryId: itinerary.id },
                    })
                );
            }
            if (hotelReservationId) {
                updatePromises.push(
                    prisma.hotelReservation.update({
                        where: { id: Number(hotelReservationId) },
                        data: { itineraryId: itinerary.id },
                    })
                );
            }
            await Promise.all(updatePromises);

            // Create a notification for the user.
            await prisma.notification.create({
                data: {
                    userId: userId,
                    content: `Your itinerary (ID: ${itinerary.id}) has been created successfully.`,
                },
            });

            // If a hotel reservation exists, create a notification for the hotel owner.
            if (
                hotelReservationId &&
                hotelReservation &&
                hotelReservation.hotelId
            ) {
                const hotel = await prisma.hotel.findUnique({
                    where: { id: hotelReservation.hotelId },
                    select: { ownerId: true, name: true },
                });
                if (hotel && hotel.ownerId) {
                    await prisma.notification.create({
                        data: {
                            userId: hotel.ownerId,
                            content: `A new booking has been made for your hotel "${hotel.name}".`,
                        },
                    });
                }
            }

            // Return the newly created itinerary details.
            return prisma.itinerary.findUnique({
                where: { id: itinerary.id },
                select: {
                    id: true,
                    flight: flightReservationId ? true : false,
                    hotel: hotelReservationId ? true : false,
                    status: true,
                },
            });
        });

        return NextResponse.json(
            { message: "Itinerary created successfully", reservations: result },
            { status: 201 }
        );
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}
