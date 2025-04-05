import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";


export async function GET(request : NextRequest) {
  try {
    // Parse query parameters from the request URL
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";

    // Fetch matching cities from the db using a case-insensitive partial match
    const cities = await prisma.city.findMany({
      where: {
        name: {
          contains: query,
        },
      },
      take: 10,
    });
    

    return NextResponse.json({ cities });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to retrieve cities" },
      { status: 500 }
    );
  }
}
