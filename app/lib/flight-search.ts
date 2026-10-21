export interface FlightSearch {
  origin: string;
  destination: string;
  date: string;
  returnDate: string;
  tripType: "one-way" | "round-trip";
}

export function readFlightSearch(params: URLSearchParams): FlightSearch {
  return {origin:params.get("origin")?.trim() ?? "",destination:params.get("destination")?.trim() ?? "",date:params.get("date") ?? "",returnDate:params.get("returnDate") ?? "",tripType:params.get("tripType") === "round-trip" ? "round-trip" : "one-way"};
}

export function flightSearchPath(search: FlightSearch): string {
  const params = new URLSearchParams({origin:search.origin.trim(),destination:search.destination.trim(),date:search.date,tripType:search.tripType});
  if (search.tripType === "round-trip") params.set("returnDate",search.returnDate);
  return `/flights?${params}`;
}
