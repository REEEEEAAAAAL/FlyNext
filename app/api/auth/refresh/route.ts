// /app/api/auth/refresh.js
import jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import { generateAccessToken } from "@/lib/auth";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // get cookies from the http header
  const cookies = request.headers.get("cookie");
  if (!cookies) {
    return NextResponse.json({ message: "No refresh token provided" }, { status: 401 });
  }
  
  // get the Refresh Token stored in the cookies
  const refreshCookie = cookies.split(";").find((c : string)=> c.trim().startsWith("refreshToken="));
  if (!refreshCookie) {
    return NextResponse.json({ message: "No refresh token provided" }, { status: 401 });
  }
  const refreshToken = refreshCookie.split("=")[1];
  
  try {
        if (!process.env.JWT_REFRESH_SECRET) {
            return NextResponse.json(
                { error: "JWT refresh secret is not defined" },
                { status: 500 }
            );
        }

    // verify the Refresh Token
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // generate the new Access Token
        const newAccessToken = generateAccessToken({
            userId: (payload as JwtPayload).userId,
        });

    return NextResponse.json({ accessToken: newAccessToken }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Invalid or expired Refresh Token" }, { status: 403 });
  }
}
