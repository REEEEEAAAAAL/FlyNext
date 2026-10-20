import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/app/lib/return-path";

describe("sign-in continuation", () => {
  it.each(["/flights", "/hotels/12/room-types/4", "/checkout?itineraryId=42", "/user/hotel-bookings/7", "/itineraries/new"]) ("preserves the application destination %s", path => {
    expect(safeReturnPath(path)).toBe(path);
  });
  it.each([null, "https://elsewhere.example", "//elsewhere.example", "/\\elsewhere.example", "/auth/logout", "/hotels\n/12", "/hotels-elsewhere", "/hotels/../auth/logout", "/hotels/%2e%2e/auth/logout"]) ("rejects invalid or looping destinations %s", path => {
    expect(safeReturnPath(path)).toBe("/");
  });
});
