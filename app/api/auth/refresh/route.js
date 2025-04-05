// /app/api/auth/refresh.js
import jwt from "jsonwebtoken";
import { generateAccessToken } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request) {
  // get cookies from the http header
  const cookies = request.headers.get("cookie");
  if (!cookies) {
    return NextResponse.json({ message: "No refresh token provided" }, { status: 401 });
  }
  
  // get the Refresh Token stored in the cookies
  const refreshCookie = cookies.split(";").find(c => c.trim().startsWith("refreshToken="));
  if (!refreshCookie) {
    return NextResponse.json({ message: "No refresh token provided" }, { status: 401 });
  }
  const refreshToken = refreshCookie.split("=")[1];
  
  try {
    // verify the Refresh Token
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // generate the new Access Token
    const newAccessToken = generateAccessToken({ userId: payload.userId });
    return NextResponse.json({ accessToken: newAccessToken }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Invalid or expired Refresh Token" }, { status: 403 });
  }
}
