/**
 * `GET /api/locations/airports?q=` — airport autocomplete for the flight search.
 *
 * Response contract, relied on by `app/flights/page.tsx`:
 * - `200 { airports: AirportDto[] }`
 *
 * All three matched columns use `mode: "insensitive"`, so `"pek"` finds `"PEK"`
 * and `"beijing"` finds `"Beijing"`. The query string is trimmed and capped, and
 * the result is limited to a suggestion-sized page.
 */

import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export const GET = withRoute(async (request) => {
	const { searchParams } = new URL(request.url);
	const query = (searchParams.get("q") ?? "").trim().slice(0, 100);

	const airports = await prisma.airport.findMany({
		where: {
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ code: { contains: query, mode: "insensitive" } },
				{ city: { is: { name: { contains: query, mode: "insensitive" } } } },
			],
		},
		orderBy: { name: "asc" },
		// Top 10 suggestions: enough for a dropdown, small enough to stay cheap.
		take: 10,
	});

	return jsonOk({ airports });
});
