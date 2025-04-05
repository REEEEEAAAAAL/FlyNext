// app/api/hotels/owner/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

export async function GET(request: NextRequest) {
  const payload = await verifyToken(request) as JwtPayload | null;
  if (!payload) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { searchParams } = new URL(request.url);
  const startdate = searchParams.get("startdate");
  const enddate = searchParams.get("enddate");
  const roomTypeId = searchParams.get("roomTypeId");

  try {
    // search for the user
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { IsHotelOwner: true },
    });

    // if the user is not found or the user is not a hotel owner, raise error
    // if (!user || !user.IsHotelOwner) {
    //   return new Response(
    //     JSON.stringify({ message: "User is not a hotel owner" }),
    //     { status: 403, headers: { "Content-Type": "application/json" } }
    //   );
    // }

    // search for all the hotels
    const hotels = await prisma.hotel.findMany({
      where: { ownerId: payload.userId },
      select: {
        id: true,
        name: true,
        logo: true,
        address: true,
        location: true,
        starRating: true,
        images: true,
        roomTypes: true,
      },
    });
    
    // if (!hotels || hotels.length === 0) {
    //   return new Response(
    //     JSON.stringify({ message: "No hotels found for this owner" }),
    //     { status: 404, headers: { "Content-Type": "application/json" } }
    //   );
    // }
    
    const hotelIds = hotels.map((hotel) => hotel.id);

    // set up filter conditions
    const filter = { hotelId: { in: hotelIds } } as any;
    if (startdate && enddate) {
      filter.checkIn = {
        gte: new Date(startdate),
        lte: new Date(enddate),
      };
    } else if (startdate) {
      filter.checkIn = { gte: new Date(startdate) };
    } else if (enddate) {
      filter.checkIn = { lte: new Date(enddate) };
    }
    if (roomTypeId) {
      filter.roomTypeId = Number(roomTypeId);
    }

    const reservations = await prisma.hotelReservation.findMany({
      where: filter,
      include: {
        roomType: true,
        hotel: true,
        user: true,
      },
      orderBy: { checkIn: "asc" },
    });

    return new Response(JSON.stringify({ hotels, reservations }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
