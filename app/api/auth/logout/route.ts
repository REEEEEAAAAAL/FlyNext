// app/api/auth/logout/route.js
import * as cookie from "cookie";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // clear the Cookie that stored the refresh token
    const cookieHeader = cookie.serialize("refreshToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });

    const headers = new Headers();
    headers.append("Set-Cookie", cookieHeader);
    headers.append("Content-Type", "application/json");

    return new Response(
      JSON.stringify({ message: "Logout successful" }),
      { status: 200, headers }
    );
  } catch (error) {
    return new Response(
        JSON.stringify({
            error: "Error logging out",
            details: (error as Error).message,
        }),
        { status: 500 }
    );
  }
}