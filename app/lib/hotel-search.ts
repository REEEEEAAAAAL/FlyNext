import { addDays, atMidnight, AVAILABILITY_HORIZON_ERROR, isStayWithinAvailabilityHorizon, parseDateOnly, parseStayRange } from "@/lib/api/validation";

export interface HotelSearch {
  city: string;
  checkIn: string;
  checkOut: string;
  name: string;
  starRating: string;
  priceMin: string;
  priceMax: string;
}

export const EMPTY_HOTEL_SEARCH: HotelSearch = { city: "", checkIn: "", checkOut: "", name: "", starRating: "", priceMin: "", priceMax: "" };

export function readHotelSearch(params: URLSearchParams): HotelSearch {
  const value = (key: string) => params.get(key)?.trim() ?? "";
  return { city: value("city"), checkIn: value("checkIn"), checkOut: value("checkOut"), name: value("name"), starRating: value("starRating"), priceMin: value("priceMin"), priceMax: value("priceMax") };
}

export function hotelSearchParams(search: HotelSearch): URLSearchParams {
  return new URLSearchParams(Object.entries(search).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== ""));
}

export function hotelSearchPath(search: HotelSearch): string {
  const query = hotelSearchParams(search).toString();
  return `/hotels${query ? `?${query}` : ""}`;
}

export function hotelCheckoutMin(checkIn: string, today: Date = new Date()): string {
  let start = atMidnight(today);
  try {
    if (checkIn) start = parseDateOnly(checkIn, "checkIn");
  } catch {
    start = atMidnight(today);
  }
  return addDays(start, 1).toISOString().slice(0, 10);
}

export function validateHotelSearch(search: HotelSearch): string | null {
  if (Boolean(search.checkIn) !== Boolean(search.checkOut)) return "Choose both check-in and check-out dates.";
  if (search.checkIn && search.checkOut) {
    try {
      const stay = parseStayRange(search.checkIn, search.checkOut);
      if (!isStayWithinAvailabilityHorizon(stay.checkIn, stay.checkOut)) return AVAILABILITY_HORIZON_ERROR;
    } catch (error) {
      return error instanceof Error ? error.message : "Choose valid stay dates.";
    }
  }
  if (search.priceMin && search.priceMax && Number(search.priceMin) > Number(search.priceMax)) return "Maximum nightly rate must be at least the minimum.";
  return null;
}
