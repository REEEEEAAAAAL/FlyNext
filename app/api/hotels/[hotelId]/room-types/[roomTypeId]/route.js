// app/api/hotels/[hotelId]/room-types/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// GET /api/hotels/[hotelId]/room-types/[roomTypeId]
export async function GET(request, { params }) {
  const { hotelId, roomTypeId } = await params;
  
  try {
    // Fetch the room type details including reservations.
    const roomType = await prisma.roomType.findUnique({
      where: { id: Number(roomTypeId) },
      include: { reservations: true },
    });
    if (!roomType) {
      return new Response(
        JSON.stringify({ message: "Room type not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Define date range: today (set to 00:00:00) through two months later.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 2);

    // Generate dates array for today and the next two months.
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }

    // For each day in the range, ensure an availability record exists.
    for (const day of days) {
      const existingRecord = await prisma.roomAvailabilityRecord.findFirst({
        where: {
          roomTypeId: Number(roomTypeId),
          date: day,
        },
      });
      if (!existingRecord) {
        await prisma.roomAvailabilityRecord.create({
          data: {
            roomTypeId: Number(roomTypeId),
            date: day,
            availability: roomType.currentAvailability, // default availability
          },
        });
      }
    }

    // Now query all availability records in the date range.
    const availabilityRecords = await prisma.roomAvailabilityRecord.findMany({
      where: {
        roomTypeId: Number(roomTypeId),
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { date: "asc" },
    });

    return new Response(
      JSON.stringify({ roomType, availabilityRecords }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching room type:", error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PUT /api/hotels/[hotelId]/room-types/[roomTypeId]
export async function PUT(request, { params }) {
  const { hotelId, roomTypeId } = await params;

  // verify login status
  const payload = await verifyToken(request);
  if (!payload) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // check if the hotel exists and the user is the owner
  const hotel = await prisma.hotel.findUnique({ where: { id: Number(hotelId) } });
  if (!hotel) {
    return new Response(JSON.stringify({ message: "Hotel not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (hotel.ownerId !== payload.userId) {
    return new Response(JSON.stringify({ message: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Use formData() to handle multipart/form-data for potential file uploads.
    const formData = await request.formData();

    // Process text fields.
    const name = formData.get("name");
    const amenities = formData.get("amenities");
    const pricePerNight = formData.get("pricePerNight");
    const currentAvailability = formData.get("currentAvailability");

    // Prepare the updates object.
    const updates = {};
    if (name) updates.name = name;
    if (amenities) updates.amenities = amenities;
    if (pricePerNight) updates.pricePerNight = parseFloat(pricePerNight);
    if (currentAvailability) updates.currentAvailability = Number(currentAvailability);

    // Process images from the form.
    // The formData "images" field may contain both File objects (new uploads) and strings (existing URLs).
    const imagesEntries = formData.getAll("images");
    const imagesUrls = [];
    if (imagesEntries) {
      const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
      const maxSize = 5 * 1024 * 1024; // 5MB

      for (const entry of imagesEntries) {
        // If the entry is a string, it is an existing image URL.
        if (typeof entry === "string") {
          imagesUrls.push(entry);
        } else if (entry && entry.size > 0) {
          // Otherwise, it is a File object, so process the upload.
          if (!allowedTypes.includes(entry.type)) {
            return new Response(
              JSON.stringify({ error: "Invalid file type for one of the images." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          if (entry.size > maxSize) {
            return new Response(
              JSON.stringify({ error: "One of the image files exceeds 5MB." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          try {
            const fileExtension = entry.name.split(".").pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const uploadDir = path.join(process.cwd(), "public", "uploads", "roomTypes");
            const filePath = path.join(uploadDir, fileName);
            const buffer = await entry.arrayBuffer();
            await writeFile(filePath, Buffer.from(buffer));
            imagesUrls.push(`/uploads/roomTypes/${fileName}`);
          } catch (error) {
            console.error("Error saving image file:", error);
            return new Response(
              JSON.stringify({ error: "Failed to upload one of the images." }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
      }
    }
    // Update the room type's images to exactly the imagesUrls array (even if it's empty).
    updates.images = imagesUrls;

    // Update the room type.
    const updatedRoomType = await prisma.roomType.update({
      where: { id: Number(roomTypeId) },
      data: updates,
    });
    return new Response(
      JSON.stringify({ message: "Room type updated", roomType: updatedRoomType }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error updating room type:", error);
    return new Response(JSON.stringify({ message: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/hotels/[hotelId]/room-types/[roomTypeId]
export async function DELETE(request, { params }) {
  const { hotelId, roomTypeId } = await params;

  // verify login status
  const payload = await verifyToken(request);
  if (!payload) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // check if the hotel exists and the user is the owner
  const hotel = await prisma.hotel.findUnique({ where: { id: Number(hotelId) } });
  if (!hotel) {
    return new Response(JSON.stringify({ message: "Hotel not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (hotel.ownerId !== payload.userId) {
    return new Response(JSON.stringify({ message: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  
  try {
    await prisma.roomType.delete({
      where: { id: Number(roomTypeId) },
    });
    return new Response(JSON.stringify({ message: "Room type deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting room type:", error);
    return new Response(JSON.stringify({ message: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
