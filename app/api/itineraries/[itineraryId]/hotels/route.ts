// app/api/itineraries/[itineraryId]/hotels/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// Cancel the hotel booking.
export async function DELETE(
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

        // Extract itineraryId from the route parameters.
        const { itineraryId } = params;

        // Find the hotel reservation associated with the itinerary that belongs to the user.
        const hotelReservation = await prisma.hotelReservation.findUnique({
            where: {
                itineraryId: Number(itineraryId),
                userId: currentUser.userId,
            },
            include: { hotel: true },
        }) as any;
        if (!hotelReservation) {
            return NextResponse.json(
                { error: "Hotel booking not found" },
                { status: 404 }
            );
        }

        // Check permission: the requester must be the booker or the hotel owner.
        if (
            currentUser.userId !== hotelReservation.userId &&
            currentUser.userId !== hotelReservation.hotel.ownerId
        ) {
            return NextResponse.json(
                { error: "You do not have permission to cancel this booking" },
                { status: 403 }
            );
        }

        // Cancel the hotel reservation.
        await prisma.hotelReservation.update({
            where: { id: hotelReservation.id },
            data: { status: "CANCELLED" },
        });

        // Update the room availability.
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

        // Update the itinerary price.
        await prisma.itinerary.update({
            where: { id: Number(itineraryId), userId: currentUser.id },
            data: { totalPrice: { decrement: hotelReservation.price } },
        });

        // Send a notification to the client (user) informing them of the cancellation.
        await prisma.notification.create({
            data: {
                userId: hotelReservation.userId,
                content: `Your hotel booking for "${hotelReservation.hotel.name}" has been cancelled by the hotel owner.`,
            },
        });

        return NextResponse.json({
            message: "Hotel booking cancelled successfully",
        });
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message || "Hotel booking cancellation failed" },
            { status: 500 }
        );
    }
}
