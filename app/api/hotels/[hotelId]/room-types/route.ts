// app/api/hotels/[hotelId]/room-types/route.js
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// GET /api/hotels/[hotelId]/room-types
export async function GET(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    const { hotelId } = await params;
    try {
        const roomTypes = await prisma.roomType.findMany({
            where: { hotelId: Number(hotelId) },
        });
        return new Response(JSON.stringify({ roomTypes: roomTypes }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error fetching room types:", error);
        return new Response(
            JSON.stringify({ message: "Internal server error" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

// POST /api/hotels/[hotelId]/room-types
export async function POST(
    request: NextRequest,
    { params }: { params: { [key: string]: string } }
) {
    const { hotelId } = await params;
    const payload = await verifyToken(request) as JwtPayload | null;
    if (!payload) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
    // check if the user exists and the user is the owner
    const hotel = await prisma.hotel.findUnique({
        where: { id: Number(hotelId) },
    });
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
        // Use formData() to handle multipart/form-data requests
        const formData = await request.formData();

        // Process text fields
        const name = formData.get("name") as string;
        const amenities = formData.get("amenities") as string;
        const pricePerNight = formData.get("pricePerNight") as string;
        const currentAvailability = formData.get("currentAvailability");

        if (
            !name ||
            !pricePerNight ||
            currentAvailability === null ||
            currentAvailability === undefined
        ) {
            return new Response(
                JSON.stringify({ message: "Missing required fields" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        // Process images files if provided (support multiple file uploads)
        let imagesUrls = [];
        const imagesFiles = formData.getAll("images");
        if (imagesFiles && imagesFiles.length > 0) {
            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/jpg",
                "image/webp",
            ];
            const maxSize = 5 * 1024 * 1024; // 5MB
            for (const imageFile of imagesFiles as File[]) {
                if (imageFile && imageFile.size > 0) {
                    if (!allowedTypes.includes(imageFile.type)) {
                        return new Response(
                            JSON.stringify({
                                error: "Invalid file type for one of the images.",
                            }),
                            {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }
                    if (imageFile.size > maxSize) {
                        return new Response(
                            JSON.stringify({
                                error: "One of the image files exceeds 5MB.",
                            }),
                            {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }
                    try {
                        const fileExtension = imageFile.name.split(".").pop();
                        const fileName = `${uuidv4()}.${fileExtension}`;
                        const uploadDir = path.join(
                            process.cwd(),
                            "public",
                            "uploads",
                            "roomTypes"
                        );
                        const filePath = path.join(uploadDir, fileName);
                        const buffer = await imageFile.arrayBuffer();
                        await writeFile(filePath, Buffer.from(buffer));
                        imagesUrls.push(`/uploads/roomTypes/${fileName}`);
                    } catch (error) {
                        console.error("Error saving image file:", error);
                        return new Response(
                            JSON.stringify({
                                error: "Failed to upload one of the images.",
                            }),
                            {
                                status: 500,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }
                }
            }
        }

        // Create the room type
        const roomType = await prisma.roomType.create({
            data: {
                name,
                amenities,
                pricePerNight: parseFloat(pricePerNight),
                images: imagesUrls,
                currentAvailability: Number(currentAvailability),
                hotel: { connect: { id: Number(hotelId) } },
            },
        });
        // Create room availability record
        const today = new Date();
        await prisma.roomAvailabilityRecord.create({
            data: {
                date: today,
                availability: roomType.currentAvailability,
                RoomType: { connect: { id: roomType.id } },
            },
        });
        return new Response(
            JSON.stringify({
                message: "Room type created",
                roomTypeId: roomType.id,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error creating room type:", error);
        return new Response(
            JSON.stringify({ message: "Internal server error" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
