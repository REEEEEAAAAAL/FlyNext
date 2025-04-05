// app/api/hotels/[hotelId]/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// GET /api/hotels/:hotelId
export async function GET(request, { params }) {
  const { hotelId } = await params;
  try {
    const hotel = await prisma.hotel.findUnique({
      where: { id: Number(hotelId) },
      include: { roomTypes: true },
    });

    if (!hotel) {
      return new Response(
        JSON.stringify({ error: "Hotel not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ hotel }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching hotel:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// PUT /api/hotels/:hotelId
export async function PUT(request, { params }) {
  const { hotelId } = await params;

  // verify token
  const payload = await verifyToken(request);
  if (!payload) {
    return new Response(
      JSON.stringify({ message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // check if the hotel exists, and the user is the owner
  const hotel = await prisma.hotel.findUnique({
    where: { id: Number(hotelId) },
  });
  if (!hotel) {
    return new Response(
      JSON.stringify({ message: "Hotel not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  if (hotel.ownerId !== payload.userId) {
    return new Response(
      JSON.stringify({ message: "Operation is forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Use formData() to handle multipart/form-data for file uploads
    const formData = await request.formData();

    // Prepare updates object by processing text fields
    const updates = {};
    const textFields = ["name", "address", "location", "starRating"];
    textFields.forEach((field) => {
      if (formData.has(field)) {
        updates[field] = formData.get(field);
      }
    });
    // convert starRating 
    if (updates.starRating) {
      updates.starRating = Number(updates.starRating);
    }

    // Process logo file if provided
    const logoFile = formData.get("logo");
    if (logoFile && logoFile.size > 0) {
      const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
      if (!allowedTypes.includes(logoFile.type)) {
        return new Response(
          JSON.stringify({ error: "Invalid file type for logo. Only JPEG, PNG, and WebP images are allowed." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (logoFile.size > maxSize) {
        return new Response(
          JSON.stringify({ error: "Logo file size exceeds 5MB." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        const fileExtension = logoFile.name.split(".").pop();
        const fileName = `${uuidv4()}.${fileExtension}`;
        const uploadDir = path.join(process.cwd(), "public", "uploads", "hotels");
        const filePath = path.join(uploadDir, fileName);
        const buffer = await logoFile.arrayBuffer();
        await writeFile(filePath, Buffer.from(buffer));
        updates.logo = `/uploads/hotels/${fileName}`;
      } catch (error) {
        console.error("Error saving logo file:", error);
        return new Response(
          JSON.stringify({ error: "Failed to upload logo" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Process images files if provided (支持多文件上传)
    const imagesFiles = formData.getAll("images");
    if (imagesFiles && imagesFiles.length > 0) {
      const imagesUrls = [];
      for (const imageFile of imagesFiles) {
        if (imageFile && imageFile.size > 0) {
          const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
          if (!allowedTypes.includes(imageFile.type)) {
            return new Response(
              JSON.stringify({ error: "Invalid file type for one of the images." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          const maxSize = 5 * 1024 * 1024; // 5MB
          if (imageFile.size > maxSize) {
            return new Response(
              JSON.stringify({ error: "One of the image files exceeds 5MB." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          try {
            const fileExtension = imageFile.name.split(".").pop();
            const fileName = `${uuidv4()}.${fileExtension}`;
            const uploadDir = path.join(process.cwd(), "public", "uploads", "hotels");
            const filePath = path.join(uploadDir, fileName);
            const buffer = await imageFile.arrayBuffer();
            await writeFile(filePath, Buffer.from(buffer));
            imagesUrls.push(`/uploads/hotels/${fileName}`);
          } catch (error) {
            console.error("Error saving image file:", error);
            return new Response(
              JSON.stringify({ error: "Failed to upload one of the images." }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
      }
      // 如果传入了 images 文件，则更新 images 字段为上传后的 URL 数组
      updates.images = imagesUrls;
    }

    const updatedHotel = await prisma.hotel.update({
      where: { id: Number(hotelId) },
      data: updates,
    });

    return new Response(
      JSON.stringify({ message: "Hotel updated", hotel: updatedHotel }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error updating hotel:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// DELETE /api/hotels/:hotelId
export async function DELETE(request, { params }) {
  const { hotelId } = await params;
  
  // verify token
  const payload = await verifyToken(request);
  if (!payload) {
    return new Response(
      JSON.stringify({ message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // check if the hotel exists, and the user is the owner
  const hotel = await prisma.hotel.findUnique({
    where: { id: Number(hotelId) },
  });
  if (!hotel) {
    return new Response(
      JSON.stringify({ message: "Hotel not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  if (hotel.ownerId !== payload.userId) {
    return new Response(
      JSON.stringify({ message: "Operation is forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    await prisma.hotel.delete({
      where: { id: Number(hotelId) },
    });
    return new Response(
      JSON.stringify({ message: "Hotel deleted" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error deleting hotel:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
