/**
 * The display helpers behind the flight and hotel booking pages.
 *
 * Two of these are contract-bearing rather than cosmetic:
 *
 * - {@link bookingReference} is the short handle a traveller reads out and the
 *   pages print as "Booking #". It has to stay the first six characters of the
 *   provider's id, upper-cased, because that is exactly how the provider mints
 *   its own `bookingReference` — a heading that disagreed with the reference on
 *   the ticket would be worse than showing the full UUID.
 * - {@link flightDirections} decides whether a booking renders one card or two,
 *   which is what stops a one-way trip from showing an empty "Return" panel.
 */

import { describe, expect, it } from "vitest";
import {
	bookingReference,
	flightDirections,
	formatLegDate,
	hasLegValue,
	hotelReference,
	stayNights,
	transferAirports,
} from "@/app/lib/booking-display";
import type { FlightLegDto } from "@/types";

/** The single-space sentinel both booking endpoints emit for an absent leg. */
const ABSENT = " ";

function leg(overrides: Partial<FlightLegDto> = {}): FlightLegDto {
	return {
		goDate: "2026-06-01T08:00:00.000Z",
		goAirport: "YYZ",
		returnDate: ABSENT,
		returnAirport: ABSENT,
		goLegs: [],
		returnLegs: [],
		...overrides,
	};
}

/** One flown leg, as the booking endpoints serialise it. */
function segment(
	from: string,
	to: string,
	departDate: string,
	arriveDate: string
) {
	return { from, to, departDate, arriveDate };
}

describe("bookingReference", () => {
	it("is the provider's first six characters, upper-cased", () => {
		expect(
			bookingReference("e33708fa-0caf-4b52-9564-cd2bc1ac11b5")
		).toBe("E33708");
	});

	it("keeps the whole id when it is already short", () => {
		expect(bookingReference("ab12")).toBe("AB12");
	});

	it("never renders an empty heading", () => {
		expect(bookingReference("")).toBe("UNKNOWN");
		expect(bookingReference("   ")).toBe("UNKNOWN");
	});
});

describe("hotelReference", () => {
	it("is a fixed-width handle, distinct from a flight reference", () => {
		expect(hotelReference(7)).toBe("H-000007");
		expect(hotelReference(1234567)).toBe("H-1234567");
	});
});

describe("hasLegValue", () => {
	it("treats the sentinel, null and blank as absent", () => {
		expect(hasLegValue(ABSENT)).toBe(false);
		expect(hasLegValue(null)).toBe(false);
		expect(hasLegValue(undefined)).toBe(false);
		expect(hasLegValue("")).toBe(false);
		expect(hasLegValue("  ")).toBe(false);
	});

	it("accepts a real value", () => {
		expect(hasLegValue("2026-06-08T08:00:00.000Z")).toBe(true);
		expect(hasLegValue("LHR")).toBe(true);
	});
});

describe("flightDirections", () => {
	it("returns only the outbound for a one-way booking", () => {
		const directions = flightDirections(
			leg(),
			leg({ goDate: "2026-06-01T12:00:00.000Z", goAirport: "LHR" })
		);

		expect(directions).toHaveLength(1);
		expect(directions[0]).toMatchObject({
			kind: "outbound",
			from: "YYZ",
			to: "LHR",
			departDate: "2026-06-01T08:00:00.000Z",
			arriveDate: "2026-06-01T12:00:00.000Z",
		});
	});

	it("returns both directions for a round trip, return leg included", () => {
		const directions = flightDirections(
			leg({
				returnDate: "2026-06-08T18:00:00.000Z",
				returnAirport: "LHR",
			}),
			leg({
				goDate: "2026-06-01T12:00:00.000Z",
				goAirport: "LHR",
				returnDate: "2026-06-08T22:00:00.000Z",
				returnAirport: "YYZ",
			})
		);

		expect(directions.map((direction) => direction.kind)).toEqual([
			"outbound",
			"return",
		]);
		expect(directions[1]).toMatchObject({
			from: "LHR",
			to: "YYZ",
			departDate: "2026-06-08T18:00:00.000Z",
			arriveDate: "2026-06-08T22:00:00.000Z",
		});
	});

	it("shows the return leg when only one of its two columns was written", () => {
		/*
		 * `departure` and `arrival` are always written together, but a row that
		 * reached the table from outside that path — a backfill, a manual repair,
		 * an import — may carry only half of the return leg. Rendering it with an
		 * "N/A" for the missing half is better than dropping a flight the
		 * passenger took.
		 */
		const directions = flightDirections(
			leg({ returnAirport: "LHR" }),
			leg({ goDate: "2026-06-01T12:00:00.000Z", goAirport: "LHR" })
		);

		expect(directions).toHaveLength(2);
		expect(directions[1].departDate).toBe(ABSENT);
		expect(directions[1].from).toBe("LHR");
	});

	it("names the airports a direction changes planes at", () => {
		/*
		 * `YYZ→HKG→CAN` is one outbound direction from Toronto to Guangzhou, and
		 * "From YYZ To CAN" alone reads as a non-stop flight: the transfer is what
		 * tells the traveller where they change planes.
		 */
		const directions = flightDirections(
			leg({
				goLegs: [
					segment(
						"YYZ",
						"HKG",
						"2026-06-01T08:00:00.000Z",
						"2026-06-01T20:00:00.000Z"
					),
					segment(
						"HKG",
						"CAN",
						"2026-06-01T22:00:00.000Z",
						"2026-06-01T23:30:00.000Z"
					),
				],
			}),
			leg({
				goDate: "2026-06-01T23:30:00.000Z",
				goAirport: "CAN"
			})
		);

		expect(directions).toHaveLength(1);
		expect(directions[0]).toMatchObject({
			from: "YYZ",
			to: "CAN",
			stops: ["HKG"],
		});
		expect(directions[0].legs).toHaveLength(2);
		expect(directions[0].legs[0]).toMatchObject({ from: "YYZ", to: "HKG" });
	});

	it("keeps each direction's own connections apart on a round trip", () => {
		const directions = flightDirections(
			leg({
				goLegs: [
					segment("YYZ", "HKG", "2026-06-01T08:00:00.000Z", "2026-06-01T20:00:00.000Z"),
					segment("HKG", "CAN", "2026-06-01T22:00:00.000Z", "2026-06-01T23:30:00.000Z"),
				],
				returnLegs: [
					segment("CAN", "DXB", "2026-06-10T08:00:00.000Z", "2026-06-10T18:00:00.000Z"),
					segment("DXB", "YYZ", "2026-06-10T20:00:00.000Z", "2026-06-11T06:00:00.000Z"),
				],
				returnDate: "2026-06-10T08:00:00.000Z",
				returnAirport: "CAN",
			}),
			leg({
				goDate: "2026-06-01T23:30:00.000Z",
				goAirport: "CAN",
				returnDate: "2026-06-11T06:00:00.000Z",
				returnAirport: "YYZ",
			})
		);

		expect(directions.map((direction) => direction.stops)).toEqual([
			["HKG"],
			["DXB"],
		]);
		expect(directions[1]).toMatchObject({ from: "CAN", to: "YYZ" });
	});

	it("falls back to one flight for a row that never recorded its legs", () => {
		/*
		 * A booking written before the legs were stored has only the four summary
		 * values. It must still render a direction — just without the connections
		 * that were never recorded.
		 */
		const directions = flightDirections(
			leg(),
			leg({ goDate: "2026-06-01T12:00:00.000Z", goAirport: "LHR" })
		);

		expect(directions[0].stops).toEqual([]);
		expect(directions[0].legs).toEqual([
			{
				from: "YYZ",
				to: "LHR",
				departDate: "2026-06-01T08:00:00.000Z",
				arriveDate: "2026-06-01T12:00:00.000Z",
			},
		]);
	});
});

describe("transferAirports", () => {
	it("lists the airports after the first flight", () => {
		expect(
			transferAirports([
				segment("YYZ", "HKG", "2026-06-01T08:00:00.000Z", "2026-06-01T20:00:00.000Z"),
				segment("HKG", "CAN", "2026-06-01T22:00:00.000Z", "2026-06-01T23:30:00.000Z"),
			])
		).toEqual(["HKG"]);
	});

	it("has nothing to report for a direct flight or an unrecorded one", () => {
		expect(transferAirports([])).toEqual([]);
		expect(transferAirports(undefined)).toEqual([]);
		expect(transferAirports(null)).toEqual([]);
		expect(
			transferAirports([
				segment("YYZ", "LHR", "2026-06-01T08:00:00.000Z", "2026-06-01T20:00:00.000Z"),
			])
		).toEqual([]);
	});

	it("reads a raw JSON column as well as a serialised one", () => {
		// The itinerary pages hold the Prisma column, where an absent field is
		// `null` rather than the endpoint's single-space sentinel — and where a
		// flight that was never recorded is a row with no airports at all.
		const stored: {
			from: string | null;
			to: string | null;
			departDate: string | null;
			arriveDate: string | null;
		}[] = [
			{ from: "YYZ", to: "HKG", departDate: null, arriveDate: null },
			{ from: null, to: "CAN", departDate: null, arriveDate: null },
			{ from: "CAN", to: "YYZ", departDate: null, arriveDate: null },
		];

		expect(transferAirports(stored)).toEqual(["CAN"]);
	});
});

describe("formatLegDate", () => {
	it("maps an absent value to N/A rather than Invalid Date", () => {
		expect(formatLegDate(ABSENT)).toBe("N/A");
		expect(formatLegDate(null)).toBe("N/A");
		expect(formatLegDate(undefined)).toBe("N/A");
		expect(formatLegDate("")).toBe("N/A");
		expect(formatLegDate("not a date")).toBe("N/A");
	});

	it("formats a real timestamp", () => {
		expect(formatLegDate("2026-06-01T08:00:00.000Z")).not.toBe("N/A");
	});
});

describe("stayNights", () => {
	it("counts the nights between check-in and check-out", () => {
		expect(stayNights("2026-06-01T00:00:00.000Z", "2026-06-04T00:00:00.000Z")).toBe(3);
	});

	it("returns null rather than a nonsense count", () => {
		expect(stayNights("2026-06-04T00:00:00.000Z", "2026-06-01T00:00:00.000Z")).toBeNull();
		expect(stayNights("2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z")).toBeNull();
		expect(stayNights(null, "2026-06-01T00:00:00.000Z")).toBeNull();
		expect(stayNights("2026-06-01T00:00:00.000Z", null)).toBeNull();
		expect(stayNights("rubbish", "2026-06-01T00:00:00.000Z")).toBeNull();
	});
});
