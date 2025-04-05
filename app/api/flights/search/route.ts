import { NextResponse } from "next/server";
import { searchFlights } from "@/lib/afs-client";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);

	try {
		const results = await searchFlights({
			origin: searchParams.get("origin") as string,
			destination: searchParams.get("destination") as string,
			date: searchParams.get("date") as string,
		});

		return NextResponse.json(results);
	} catch (error) {
		return NextResponse.json(
			{ error: (error as Error).message },
			{ status: 500 }
		);
	}
}
