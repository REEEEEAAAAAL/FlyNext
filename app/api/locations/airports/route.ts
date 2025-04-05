import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";


export async function GET(request : NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();

    // Fetch matching airports using a case-sensitive search across multiple fields.
    // If case-insensitive search is required, consider upgrading Prisma or adjusting your DB collation.
    const airports = await prisma.airport.findMany({
      where: {
        OR: [
          {
            name: {
              contains: query,
            },
          },
          {
            code: {
              contains: query,
            },
          },
          {
            city: {
              is: {
                name: {
                  contains: query,
                },
              },
            },
          },
        ],
      },
      take: 10, // show top 10 suggestions
    });

    return NextResponse.json({ airports });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to retrieve airports" },
      { status: 500 }
    );
  }
}
