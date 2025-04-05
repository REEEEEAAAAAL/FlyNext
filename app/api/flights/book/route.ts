import { NextResponse } from "next/server";
import { createBooking } from "@/lib/afs-client";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { JwtPayload } from 'jsonwebtoken';


export async function POST(request: NextRequest) {
    try {
        const user = await verifyToken(request) as JwtPayload | null;
        if (!user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }
        const body = await request.json();

        // Validate required fields
        const requiredFields = [
            "email",
            "firstName",
            "lastName",
            "passportNumber",
            "flightIds",
        ];
        const missing = requiredFields.filter((field) => !body[field]);
        if (missing.length) {
            return NextResponse.json(
                { error: `Missing required fields: ${missing.join(", ")}` },
                { status: 400 }
            );
        }

        // Create booking with AFS
        const afsBooking = await createBooking(body) as any;

        // Create flight reservation record
        const reservation = await prisma.flightReservation.create({
            data: {
                afsBookingId: afsBooking.bookingReference,
                userId: user.userId,
                departure: {
                    goDate: new Date(afsBooking.flights[0].departureTime),
                    goAirport: afsBooking.flights[0].origin.code,
                    // Include return info if available
                    returnDate:
                        afsBooking.flights.length > 1
                            ? new Date(afsBooking.flights[1].departureTime)
                            : null,
                    returnAirport:
                        afsBooking.flights.length > 1
                            ? afsBooking.flights[1].origin.code
                            : null,
                },
                arrival: {
                    goDate: new Date(afsBooking.flights[0].arrivalTime),
                    goAirport: afsBooking.flights[0].destination.code,
                    // Include return info if available
                    returnDate:
                        afsBooking.flights.length > 1
                            ? new Date(afsBooking.flights[1].arrivalTime)
                            : null,
                    returnAirport:
                        afsBooking.flights.length > 1
                            ? afsBooking.flights[1].destination.code
                            : null,
                },
                // Calculate total price from all flights
                price: afsBooking.flights.reduce(
                    (total: number, flight: any) => total + flight.price,
                    0
                ),
                status: "CONFIRMED",
            },
        });

        return NextResponse.json(
            {
                message: "Flight booking completed successfully",
                ...afsBooking,
                reservationId: reservation.id,
            },
            { status: 201 }
        );
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message || "Booking failed" },
            { status: 500 }
        );
    }
}
