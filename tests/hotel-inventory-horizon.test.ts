import { describe, expect, it } from "vitest";
import { calculateNightlyAvailability } from "@/lib/hotel-inventory";
import {
	AVAILABILITY_HORIZON_DAYS,
	AVAILABILITY_HORIZON_ERROR,
	addDays,
	availabilityHorizon,
	eachNight,
	isStayWithinAvailabilityHorizon,
	isWithinAvailabilityHorizon,
	parseDateOnly,
	parseStayRange,
} from "@/lib/api/validation";

const controlledToday = (date: string) => parseDateOnly(date, "today");

describe("future hotel inventory horizon", () => {
	it.each(["2027-01-15", "2027-06-15", "2028-01-15"])(
		"derives bookable availability on %s even when the only stored row is historical",
		(date) => {
			const today = controlledToday(date);
			const { start, end, days } = availabilityHorizon(today);
			const occupiedNight = addDays(today, 12);
			const futureDates = [today, occupiedNight, end];
			const result = calculateNightlyAvailability(
				{ id: 42, currentAvailability: 3 },
				futureDates,
				[{ date: controlledToday("2026-10-19"), availability: 1 }],
				[{ checkIn: occupiedNight, checkOut: addDays(occupiedNight, 2) }]
			);

			expect(start.toISOString()).toBe(`${date}T00:00:00.000Z`);
			expect(days).toHaveLength(AVAILABILITY_HORIZON_DAYS + 1);
			expect(end.toISOString()).toBe(addDays(today, AVAILABILITY_HORIZON_DAYS).toISOString());
			expect(result.map(row => row.availability)).toEqual([3, 2, 3]);
		}
	);

	it("supports the last sellable night and rejects the following night with the same range error", () => {
		const today = controlledToday("2027-06-15");
		const lastNight = addDays(today, AVAILABILITY_HORIZON_DAYS);
		const finalSupportedStay = { checkIn: lastNight, checkOut: addDays(lastNight, 1) };
		const unsupportedStay = { checkIn: addDays(lastNight, 1), checkOut: addDays(lastNight, 2) };

		expect(isStayWithinAvailabilityHorizon(finalSupportedStay.checkIn, finalSupportedStay.checkOut, today)).toBe(true);
		expect(isWithinAvailabilityHorizon(unsupportedStay.checkIn, today)).toBe(false);
		expect(isStayWithinAvailabilityHorizon(unsupportedStay.checkIn, unsupportedStay.checkOut, today)).toBe(false);
		expect(() => parseStayRange("2027-06-15", "2027-08-17")).toThrow(AVAILABILITY_HORIZON_ERROR);
	});

	it("enumerates UTC nights across year boundaries and leap day", () => {
		const yearBoundaryToday = controlledToday("2027-12-15");
		const leapYearToday = controlledToday("2028-01-15");
		const yearBoundary = availabilityHorizon(yearBoundaryToday);
		const leapWindow = availabilityHorizon(leapYearToday);
		const leapNights = eachNight(controlledToday("2028-02-28"), controlledToday("2028-03-02"));

		expect(yearBoundary.end.toISOString()).toBe("2028-02-13T00:00:00.000Z");
		expect(leapWindow.end.toISOString()).toBe("2028-03-15T00:00:00.000Z");
		expect(leapNights.map(night => night.toISOString())).toEqual([
			"2028-02-28T00:00:00.000Z",
			"2028-02-29T00:00:00.000Z",
			"2028-03-01T00:00:00.000Z",
		]);
	});

	it("parses a selected calendar date as UTC midnight regardless of the client time zone", () => {
		expect(parseDateOnly("2027-01-15", "checkIn").toISOString()).toBe("2027-01-15T00:00:00.000Z");
	});
});
