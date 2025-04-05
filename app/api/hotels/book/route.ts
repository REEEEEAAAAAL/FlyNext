// app/api/hotels/book/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function POST(request: NextRequest) {
  const payload = await verifyToken(request) as JwtPayload | null;
  if (!payload) {
    return new Response(
      JSON.stringify({ message: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const body = await request.json();
    const { hotelId, roomTypeId, checkIn, checkOut } = body;
    if (!hotelId || !roomTypeId || !checkIn || !checkOut) {
      return new Response(
        JSON.stringify({ message: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse check-in and check-out dates and set time to midnight.
    const checkInDate = new Date(checkIn) as Date;
    const checkOutDate = new Date(checkOut) as Date;
    checkInDate.setHours(0, 0, 0, 0);
    checkOutDate.setHours(0, 0, 0, 0);

    // Loop through each day in the booking period and check availability.
    let bookingDay = new Date(checkInDate);
    while (bookingDay < checkOutDate) {
      const record = await prisma.roomAvailabilityRecord.findFirst({
        where: {
          roomTypeId: Number(roomTypeId),
          date: bookingDay,
        },
      });
      if (!record) {
        return new Response(
          JSON.stringify({ message: "The selected date is not supported for booking." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (record.availability <= 0) {
        return new Response(
          JSON.stringify({ message: "No rooms available for the selected booking period." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      bookingDay.setDate(bookingDay.getDate() + 1);
    }

    // Calculate nights and price.
    const timeDiff = Math.abs(Number(checkOutDate) - Number(checkInDate));

    const nights = Math.ceil(timeDiff / (1000 * 3600 * 24));

    // Fetch room type to retrieve pricePerNight.
    const roomType = await prisma.roomType.findUnique({
      where: { id: Number(roomTypeId) },
    });
    if (!roomType) {
      return new Response(
        JSON.stringify({ message: "Room type not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    const price = roomType.pricePerNight * nights;

    // Create hotel reservation.
    const reservation = await prisma.hotelReservation.create({
      data: {
        user: { connect: { id: payload.userId } },
        hotel: { connect: { id: Number(hotelId) } },
        roomType: { connect: { id: Number(roomTypeId) } },
        checkIn: checkInDate,
        checkOut: checkOutDate,
        price: price,
      },
    });

    // For each day in the booking period, decrement the availability by 1.
    bookingDay = new Date(checkInDate);
    while (bookingDay < checkOutDate) {
      await prisma.roomAvailabilityRecord.updateMany({
        where: {
          roomTypeId: Number(roomTypeId),
          date: bookingDay,
        },
        data: { availability: { decrement: 1 } },
      });
      bookingDay.setDate(bookingDay.getDate() + 1);
    }

    // Optionally, update the room type's reservations connection.
    await prisma.roomType.update({
      where: { id: Number(roomTypeId) },
      data: {
        reservations: {
          connect: { id: reservation.id },
        },
      },
    });

    // Retrieve the hotel to get its owner info.
    const hotel = await prisma.hotel.findUnique({
      where: { id: Number(hotelId) },
      select: { ownerId: true, name: true },
    });

    // If the hotel has an owner, create a notification for them.
    if (hotel && hotel.ownerId) {
      await prisma.notification.create({
        data: {
          user: { connect: { id: hotel.ownerId } },
          content: `A new booking for your hotel "${hotel.name}" has been made.`,
        },
      });
    }

    return new Response(
      JSON.stringify({
        message: "Hotel reservation created successfully.",
        reservation,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { [key: string]: string } }) {
  try {
      const currentUser = await verifyToken(request) as JwtPayload | null;
      if (!currentUser) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const reservationId = searchParams.get("reservationId");

      // Find the hotel reservation by its id.
      const hotelReservation = await prisma.hotelReservation.findUnique({
          where: { id: Number(reservationId) },
          include: { hotel: true, itinerary: true },
      }) as any;
      if (!hotelReservation) {
          return NextResponse.json(
              { error: "Hotel booking not found" },
              { status: 404 }
          );
      }


      // // Check user's permission: must be the booker or the hotel owner.
      // if (currentUser.userId !== hotelReservation.hotel.ownerId) {
      //   return NextResponse.json(
      //     { error: "You do not have permission to cancel this booking" },
      //     { status: 403 }
      //   );
      // }

      // Cancel the hotel reservation.
      await prisma.hotelReservation.update({
          where: { id: hotelReservation.id },
          data: { status: "CANCELLED" },
      });

      // Update room availability if roomTypeId exists.
      const roomTypeId = hotelReservation.roomTypeId;
      if (roomTypeId) {
          const roomType = await prisma.roomType.findUnique({
              where: { id: Number(roomTypeId) },
          });
          if (roomType) {
              await prisma.roomType.update({
                  where: { id: Number(roomTypeId) },
                  data: { currentAvailability: { increment: 1 } },
              });
          }
      }

      // If an itinerary exists, update its price.
      if (hotelReservation.itineraryId) {
          await prisma.itinerary.update({
              where: {
                  id: hotelReservation.itineraryId,
                  userId: currentUser.userId,
              },
              data: { totalPrice: { decrement: hotelReservation.price } },
          });
    }
    
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
        {
            error:
                (error as Error).message || "Hotel booking cancellation failed",
        },
        { status: 500 }
    );
  }
}