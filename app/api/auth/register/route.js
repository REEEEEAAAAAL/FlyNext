// app/api/auth/register/route.js
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName, profilePic, phone } = body;

    // required fields
    if (!email || !password || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    // check if the email has been registered
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "Email already in use" }),
        { status: 409 }
      );
    }

    // hash the password to store in the database
    const hashedPassword = await hashPassword(password);

    // create and store the user in the database
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        profilePic: profilePic || null,
        phone: phone || null,
      },
    });

    return new Response(
      JSON.stringify({ message: "Registered successfully" }),
      { status: 201 }
    );
  } catch (error) {
    console.error("Register error:", error);
    return new Response(
      JSON.stringify({
        error: "Error registering user",
        details: error.message,
      }),
      { status: 500 }
    );
  }
}
