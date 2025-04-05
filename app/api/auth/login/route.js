// app/api/auth/login/route.js
import { prisma } from "@/lib/prisma";
import { generateAccessToken, generateRefreshToken } from "@/lib/auth";
import bcrypt from "bcryptjs";
import * as cookie from "cookie";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // check required fields
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        { status: 400 }
      );
    }

    // search for the user in the database
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Account does not exist" }),
        { status: 401 }
      );
    }

    // verify the password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return new Response(
        JSON.stringify({ error: "Invalid password" }),
        { status: 401 }
      );
    }

    // generate tokens using userid as the JWT payload
    const payload = { userId: user.id };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // set up HttpOnly Cookie
    const cookieHeader = cookie.serialize("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRY_TIME) * 24 * 60 * 60, // (seconds)
    });

    const headers = new Headers();
    headers.append("Set-Cookie", cookieHeader);
    headers.append("Content-Type", "application/json");

    return new Response(
      JSON.stringify({
        message: "Login successful",
        accessToken: accessToken,
      }),
      { status: 200, headers }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Error logging in user", details: error.message }),
      { status: 500 }
    );
  }
}