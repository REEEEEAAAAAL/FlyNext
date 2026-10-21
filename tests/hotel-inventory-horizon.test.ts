import { afterEach, describe, expect, it, vi } from "vitest";
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

const originalTimeZone = process.env.TZ;
afterEach(() => {
	vi.useRealTimers();
	if (originalTimeZone === undefined) delete process.env.TZ;
	else process.env.TZ = originalTimeZone;
});

describe("rolling calendar with a simulated clock", () => {
	it.each(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-06-15", "2027-12-31", "2028-01-01", "2028-01-02", "2028-02-28", "2028-02-29", "2028-03-01"])("rolls its first and last sellable nights on %s", day => {
		vi.useFakeTimers(); vi.setSystemTime(new Date(day + "T23:59:59Z"));
		const { start, end, days } = availabilityHorizon();
		expect(start).toEqual(controlledToday(day));
		expect(days).toHaveLength(61);
		expect(isStayWithinAvailabilityHorizon(start, addDays(start, 1))).toBe(true);
		expect(isStayWithinAvailabilityHorizon(end, addDays(end, 1))).toBe(true);
		expect(isStayWithinAvailabilityHorizon(addDays(start, -1), start)).toBe(false);
		expect(isStayWithinAvailabilityHorizon(end, addDays(end, 2))).toBe(false);
		vi.setSystemTime(new Date(addDays(start, 1).getTime()));
		expect(availabilityHorizon().start).toEqual(addDays(start, 1));
		expect(isWithinAvailabilityHorizon(start)).toBe(false);
	});
	it.each(["UTC", "Asia/Shanghai", "America/Toronto", "Pacific/Kiritimati", "Pacific/Honolulu"])("keeps calendar dates stable in %s across DST and year changes", zone => {
		process.env.TZ = zone;
		vi.useFakeTimers();
		for (const instant of ["2026-12-31T23:30:00-08:00", "2027-03-14T01:59:59-05:00", "2027-03-14T03:00:00-04:00", "2027-11-07T01:30:00-04:00", "2027-11-07T01:30:00-05:00"]) {
			vi.setSystemTime(new Date(instant));
			expect(availabilityHorizon().start.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
		}
		for (const [arrival, departure, nights] of [["2026-12-30", "2027-01-03", 4], ["2027-12-31", "2028-01-02", 2], ["2028-02-28", "2028-03-01", 2], ["2027-03-13", "2027-03-15", 2], ["2027-11-06", "2027-11-08", 2]] as const) {
			const stay = parseStayRange(arrival, departure);
			expect(stay.nights).toBe(nights);
			expect(eachNight(stay.checkIn, stay.checkOut)).toHaveLength(nights);
		}
	});
	it.each(["2027-02-29", "2028-02-30", "2027-04-31", "invalid", "2027-01-01T00:00:00Z"])("rejects invalid calendar input %s", value => {
		expect(() => parseDateOnly(value, "checkIn")).toThrow();
	});
	it("rejects invalid, same-day and reversed stays", () => {
		expect(isStayWithinAvailabilityHorizon(new Date(NaN), controlledToday("2028-03-01"))).toBe(false);
		expect(() => parseStayRange("2028-02-29", "2028-02-29")).toThrow();
		expect(() => parseStayRange("2028-03-01", "2028-02-29")).toThrow();
	});
});
