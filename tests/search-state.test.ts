import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_HOTEL_SEARCH, hotelCheckoutMin, hotelSearchParams, hotelSearchPath, readHotelSearch, validateHotelSearch } from "@/app/lib/hotel-search";
import { flightSearchPath, readFlightSearch } from "@/app/lib/flight-search";
import { safeReturnPath } from "@/app/lib/return-path";

afterEach(() => vi.useRealTimers());

describe("hotel search state", () => {
  it("keeps restored invalid dates from crashing the date picker", () => {
    const today = new Date("2028-02-28T12:00:00Z");
    expect(hotelCheckoutMin("not-a-date", today)).toBe("2028-02-29");
    expect(hotelCheckoutMin("2027-02-29", today)).toBe("2028-02-29");
    expect(hotelCheckoutMin("2028-02-29", today)).toBe("2028-03-01");
  });
  it("preserves every applied field through sharing, reload and sign-in continuation", () => {
    const search = {...EMPTY_HOTEL_SEARCH,city:"Toronto",checkIn:"2027-01-01",checkOut:"2027-01-03",name:"City & Lake",starRating:"4",priceMin:"80",priceMax:"200"};
    const path = hotelSearchPath(search);
    expect(readHotelSearch(new URL(path,"https://flynext.invalid").searchParams)).toEqual(search);
    expect(safeReturnPath(path)).toBe(path);
    expect(path).not.toContain("password");
  });
  it("allows browsing and date-only availability without a destination", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    expect(hotelSearchPath(EMPTY_HOTEL_SEARCH)).toBe("/hotels");
    expect(validateHotelSearch(EMPTY_HOTEL_SEARCH)).toBeNull();
    expect(validateHotelSearch({...EMPTY_HOTEL_SEARCH,checkIn:"2027-01-01",checkOut:"2027-01-03"})).toBeNull();
    expect(validateHotelSearch({...EMPTY_HOTEL_SEARCH,city:"Atlanta"})).toBeNull();
  });
  it("rejects incomplete, reversed, invalid and expired dates before availability requests", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    for (const dates of [{checkIn:"2027-01-01",checkOut:""},{checkIn:"2027-01-03",checkOut:"2027-01-01"},{checkIn:"2027-02-29",checkOut:"2027-03-01"},{checkIn:"2026-12-30",checkOut:"2027-01-02"}]) expect(validateHotelSearch({...EMPTY_HOTEL_SEARCH,...dates})).not.toBeNull();
    expect(validateHotelSearch({...EMPTY_HOTEL_SEARCH,priceMin:"200",priceMax:"100"})).not.toBeNull();
  });
  it("ignores unrelated URL fields and normalizes empty fields", () => {
    const restored = readHotelSearch(new URLSearchParams("city=%20Toronto%20&name=&next=https://example.invalid&token=private"));
    expect(hotelSearchParams(restored).toString()).toBe("city=Toronto");
  });
});

describe("flight search state", () => {
  it("restores both directions of a round trip", () => {
    const search = {origin:"YYZ",destination:"LHR",date:"2027-01-01",returnDate:"2027-01-05",tripType:"round-trip" as const};
    const path = flightSearchPath(search);
    expect(readFlightSearch(new URL(path,"https://flynext.invalid").searchParams)).toEqual(search);
    expect(safeReturnPath(path)).toBe(path);
  });
  it("does not retain an unused return date in one-way searches", () => {
    const path = flightSearchPath({origin:"YYZ",destination:"LHR",date:"2027-01-01",returnDate:"2027-01-05",tripType:"one-way"});
    expect(new URL(path,"https://flynext.invalid").searchParams.has("returnDate")).toBe(false);
    expect(readFlightSearch(new URLSearchParams("tripType=invalid")).tripType).toBe("one-way");
  });
});
