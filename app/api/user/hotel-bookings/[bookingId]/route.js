import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(request, { params }) {
	try {
		const currentUser = await verifyToken(request);
		if (!currentUser) {
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401 }
			);
		}

		const { bookingId } = await params;
		const booking = await prisma.hotelReservation.findUnique({
			where: {
				id: parseInt(bookingId),
				userId: parseInt(currentUser.userId),
			},
			include: {
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
						amenities: true,
					},
				},
			},
		});

		if (!booking) {
			return NextResponse.json(
				{ error: "Booking not found" },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			booking: {
				id: booking.id,
				status: booking.status,
				checkIn: booking.checkIn,
				checkOut: booking.checkOut,
				price: booking.price,
				hotel: {
					name: booking.hotel.name,
					address: booking.hotel.address,
					location: booking.hotel.location,
				},
				room: {
					type: booking.roomType.name,
					amenities: booking.roomType.amenities,
				},
				createdAt: booking.createdAt,
			},
		});
	} catch (error) {
		return NextResponse.json(
			{ error: "Failed to fetch hotel booking details" },
			{ status: 500 }
		);
	}
}

// cancel the hotel booking
export async function DELETE(request, { params }) {
    try {
        const currentUser = await verifyToken(request);
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }
		
        // find the hotel reservation
        const { bookingId } = await params;
		const hotelReservation = await prisma.hotelReservation.findUnique({
            where: {
                id: parseInt(bookingId),
                userId: parseInt(currentUser.userId),
            },
            include: { hotel: true },
        });
        if (!hotelReservation) {
            return NextResponse.json(
                { error: "Hotel booking not found" },
                { status: 404 }
            );
        }

        // check the user's identity, must be the booker or the hotel owner
        if (
            currentUser.userId !== hotelReservation.userId &&
            currentUser.userId !== hotelReservation.hotel.ownerId
        ) {
            return NextResponse.json(
                { error: "You do not have permission to cancel this booking" },
                { status: 403 }
            );
        }

        // cancel the hotel reservation
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

		if (hotelReservation.itineraryId) {
			try {
				// Update the itinerary price
				await prisma.itinerary.update({
					where: { id: Number(hotelReservation.itineraryId), userId: currentUser.id },
					data: { totalPrice: { decrement: hotelReservation.price } },
				});
			} catch (error) {
				console.log("Failed to update itinerary price:", error);
			}
		}

        return NextResponse.json({
            message: "Hotel booking cancelled successfully",
        });
    } catch (error) {
        return NextResponse.json(
            { error: error.message || "Hotel booking cancellation failed" },
            { status: 500 }
        );
    }
}
