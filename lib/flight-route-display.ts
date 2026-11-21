import airports from "@/prisma/seed_data/airports.json";

const cities = new Map(airports.map(airport => [airport.code, airport.city]));

/** Prefer the city quoted with the flight. Older tickets may only have an IATA code. */
export function airportLabel(code?: string | null, city?: string | null): string {
    const airport = code?.trim() ?? "";
    const place = city?.trim() || cities.get(airport.toUpperCase());
    if (!airport) return place || "Unavailable";
    return place && place.toLowerCase() !== airport.toLowerCase() ? `${place} (${airport})` : airport;
}

interface RouteLeg {
    from?: string | null;
    to?: string | null;
    originCity?: string | null;
    destinationCity?: string | null;
}

/** Each onward departure is a transfer within this direction. A turnaround belongs to the return direction. */
export function describeRoute(from?: string | null, to?: string | null, legs: readonly RouteLeg[] = []) {
    const first = legs[0];
    const last = legs[legs.length - 1];
    const stops = legs.slice(1).map((leg, index) => {
        const previous = legs[index];
        const code = leg.from?.trim() || previous.to?.trim();
        const city = leg.originCity?.trim() || (code === previous.to?.trim() ? previous.destinationCity : undefined);
        return airportLabel(code, city);
    });
    return {
        from: airportLabel(first?.from?.trim() || from, first?.originCity),
        to: airportLabel(last?.to?.trim() || to, last?.destinationCity),
        stops,
    };
}

interface DirectionColumn {
    goDate?: string | null;
    returnDate?: string | null;
    goAirport?: string | null;
    returnAirport?: string | null;
    goLegs?: RouteLeg[] | null;
    returnLegs?: RouteLeg[] | null;
}

/** Read both the stored reservation columns and the normalized booking-history response. */
export function reservationRoutes(departure?: DirectionColumn | null, arrival?: DirectionColumn | null) {
    const routes = [];
    for (const returning of [false, true]) {
        const key = returning ? "returnLegs" : "goLegs";
        const legs = departure?.[key]?.length ? departure[key] : arrival?.[key] ?? [];
        const airport = returning ? "returnAirport" : "goAirport";
        const date = returning ? "returnDate" : "goDate";
        const from = departure?.[airport], to = arrival?.[airport];
        const departDate = departure?.[date], arriveDate = arrival?.[date];
        if (returning && !legs.length && ![from, to, departDate, arriveDate].some(value => value?.trim())) continue;
        routes.push({ label: returning ? "Return" : "Outbound", departDate, arriveDate, ...describeRoute(from, to, legs) });
    }
    return routes;
}
