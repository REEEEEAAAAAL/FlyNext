/**
 * `GET /api/locations/cities?q=` — city autocomplete for the hotel search form.
 *
 * Response contract, relied on by `app/hotels/page.tsx`:
 * - `200 { cities: CityDto[] }`
 *
 * The match is case-insensitive: PostgreSQL's `contains` is case sensitive by
 * default, so without `mode: "insensitive"` typing `"london"` would find nothing
 * for a stored `"London"`. The query string is trimmed and capped, and the result
 * is limited to a suggestion-sized page.
 */

import { withRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export const GET = withRoute(async (request) => {
	const { searchParams } = new URL(request.url);
	const query = (searchParams.get("q") ?? "").trim().slice(0, 100);

	const cities = await prisma.city.findMany({
		where: {
			name: {
				contains: query,
				mode: "insensitive",
			},
		},
		orderBy: { name: "asc" },
		take: 10,
	});

	return jsonOk({ cities });
});
