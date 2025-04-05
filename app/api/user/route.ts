import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { JwtPayload } from "jsonwebtoken";

// GET /api/user
// Fetches the current user's profile.
export async function GET(request: NextRequest) {
    try {
        // Authentication check: verifyToken returns the JWT payload.
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Extract the user identifier from the token payload.
        const userId = currentUser.userId || currentUser.id;
        if (!userId) {
            return NextResponse.json(
                { error: "User identifier missing in token" },
                { status: 400 }
            );
        }

        // Fetch user data
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                phone: true,
                IsHotelOwner: true,
            },
        });

        if (!user) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }
        const userWithDefaultAvatar = {
            ...user,
            profilePic: user.profilePic || "/user-profile-default.svg",
        };

        return NextResponse.json({ user: userWithDefaultAvatar });
    } catch (error) {
        return NextResponse.json(
            { error: (error as Error).message || "Server error" },
            { status: 500 }
        );
    }
}

// PUT /api/user
// Updates the current user's profile.
export async function PUT(request: NextRequest) {
    try {
        // Authentication check
        const currentUser = (await verifyToken(request)) as JwtPayload | null;
        if (!currentUser) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Extract the user identifier from the token payload.
        const userId = currentUser.userId || currentUser.id;
        if (!userId) {
            return NextResponse.json(
                { error: "User identifier missing in token" },
                { status: 400 }
            );
        }

        // Since we're handling multipart/form-data now, we need to use formData()
        const formData = await request.formData();

        // Prepare the updates object
        const updates = {} as Record<string, any>;

        // Process text fields
        const textFields = ["firstName", "lastName", "phone"];
        textFields.forEach((field) => {
            if (formData.has(field)) {
                updates[field] = formData.get(field);
            }
        });

        // Process profile picture if provided
        const profilePic = formData.get("profilePic") as File;
        if (profilePic && profilePic.size > 0) {
            // Validate file type
            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/jpg",
                "image/webp",
            ];
            if (!allowedTypes.includes(profilePic.type)) {
                return NextResponse.json(
                    {
                        error: "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
                    },
                    { status: 400 }
                );
            }

            // Validate file size (e.g., 5MB max)
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (profilePic.size > maxSize) {
                return NextResponse.json(
                    {
                        error: "File size exceeds the size limit (5MB).",
                    },
                    { status: 400 }
                );
            }

            try {
                // Generate a unique filename
                const fileExtension = profilePic.name.split(".").pop();
                const fileName = `${uuidv4()}.${fileExtension}`;

                // Define the upload directory and path
                const uploadDir = path.join(
                    process.cwd(),
                    "public",
                    "uploads",
                    "userProfiles"
                );
                const filePath = path.join(uploadDir, fileName);

                // Convert file to buffer and save it
                const buffer = await profilePic.arrayBuffer();
                await writeFile(filePath, Buffer.from(buffer));

                // Set the profilePic field to the relative URL
                updates.profilePic = `/uploads/userProfiles/${fileName}`;
            } catch (error) {
                console.error("Error saving profile picture:", error);
                return NextResponse.json(
                    {
                        error: "Failed to upload profile picture",
                    },
                    { status: 500 }
                );
            }
        }

        // Update the user in the database
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updates,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                phone: true,
            },
        });

        return NextResponse.json({
            message: "Profile updated successfully.",
            user: updatedUser,
        });
    } catch (error) {
        if ((error as any).code === "P2025") {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }
        return NextResponse.json(
            { error: (error as Error).message || "Update failed" },
            { status: 500 }
        );
    }
}
