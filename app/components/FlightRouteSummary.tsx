import { reservationRoutes } from "@/lib/flight-route-display";
import type { FlightLegJson } from "@/types";

export default function FlightRouteSummary({ departure, arrival }: {
    departure?: Partial<FlightLegJson> | null;
    arrival?: Partial<FlightLegJson> | null;
}) {
    return reservationRoutes(departure, arrival).map(route => (
        <div key={route.label} className="mb-2">
            <p className="text-xs muted">{route.label}</p>
            <p className="font-semibold">{route.from} → {route.to}</p>
            {route.stops.length > 0 && <p className="text-sm">Via {route.stops.join(" → ")}</p>}
        </div>
    ));
}
