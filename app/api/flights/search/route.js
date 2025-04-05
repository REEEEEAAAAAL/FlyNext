import { NextResponse } from "next/server";
import { searchFlights } from "@/lib/afs-client";

export async function GET(request) {
	const { searchParams } = new URL(request.url);

	try {
		const results = await searchFlights({
			origin: searchParams.get("origin"),
			destination: searchParams.get("destination"),
			date: searchParams.get("date"),
		});

		return NextResponse.json(results);
	} catch (error) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status || 500 }
		);
	}
}
