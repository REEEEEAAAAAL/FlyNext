// app/api/hotels/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { JwtPayload } from 'jsonwebtoken';


// GET /api/hotels: get the list of owned hotels with given filter keywords
export async function GET(request: NextRequest) {
  try {
    // get the filter keyword from the request.url
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");  // location
    const name = searchParams.get("name");
    const starRating = searchParams.get("starRating");
    const priceMin = searchParams.get("priceMin");
    const priceMax = searchParams.get("priceMax");

    // set up the filter conditions
    const filters = {} as any;
    if (city) {
      filters.location = { contains: city };
    }
    if (name) {
      filters.name = { contains: name };
    }
    if (starRating) {
      filters.starRating = Number(starRating);
    }
    if (priceMin || priceMax) {
      filters.roomTypes = {
        some: {
          pricePerNight: {
            ...(priceMin ? { gte: Number(priceMin) } : {}),
            ...(priceMax ? { lte: Number(priceMax) } : {}),
          },
        },
      };
    }
    
    // get the list of hotels and return
    const hotels = await prisma.hotel.findMany({
      where: filters,
      include: { roomTypes: true },
    });

    return new Response(JSON.stringify( {hotels: hotels} ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ message: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/hotels: create a new hotel
export async function POST(request: NextRequest) {

  // verify user's login status
  const payload = await verifyToken(request) as JwtPayload | null;
  if (!payload) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Use formData() to handle multipart/form-data for file uploads
    const formData = await request.formData();

    // Extract text fields
    const logoFile = formData.get("logo") as File;
    const name = formData.get("name");
    const address = formData.get("address");
    const location = formData.get("location");
    const starRating = formData.get("starRating");
    const imagesFiles = formData.getAll("images");

    // Verify required fields (except logo)
    const missingFields = [];
    if (!name) {
      missingFields.push("name");
    }
    if (!address) {
      missingFields.push("address");
    }
    if (!location) {
      missingFields.push("location");
    }
    if (!starRating) {
      missingFields.push("starRating");
    }

    if (missingFields.length > 0) {
      const errorMessage = `Missing required fields: ${missingFields.join(", ")}`;
      console.error(errorMessage);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 1) 默认使用酒店默认 logo
    let logoUrl = "/hotel-logo-default.svg";

    // 2) 如果确实上传了 logo 文件，则覆盖默认值
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
        logoUrl = `/uploads/hotels/${fileName}`;
      } catch (error) {
        console.error("Error saving logo file:", error);
        return new Response(
          JSON.stringify({ error: "Failed to upload logo" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Process images files
    let imagesUrls = [];
    if (imagesFiles && imagesFiles.length > 0) {
      for (const imageFile of imagesFiles as File[]) {
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
    }

    // Create the hotel from the given information
    const hotel = await prisma.hotel.create({
      data: {
        name: name as string,
        logo: logoUrl,
        address: address as string,
        location: location as string,
        starRating: starRating ? parseFloat(starRating as string) : 1,
        images: imagesUrls,
        ownerId: payload.userId,
      },
    });

    // update the user's information
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (user && !user.IsHotelOwner) {
      await prisma.user.update({
        where: { id: payload.userId },
        data: { IsHotelOwner: true },
      });
    }
    await prisma.user.update({
      where: { id: payload.userId },
      data: {
        hotels: {
          connect: { id: hotel.id },
        },
      },
    });

    return new Response(
      JSON.stringify( {message: "Created successfully", hotelId: hotel.id} ),
      { status: 201, headers: { "Content-Type": "application/json" },}
    );
  } catch (error) {
    console.error("Error creating hotel:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
