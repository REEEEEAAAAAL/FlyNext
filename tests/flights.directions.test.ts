/**
 * How a booked itinerary is divided into the directions a traveller flies.
 *
 * This is the rule behind the booking history's cards, and the one that is easy
 * to get wrong silently: a direction is not a leg. `YYZ→HKG→CAN` is one outbound
 * journey with a change of planes, and reading its two legs as "outbound" and
 * "return" puts a one-way ticket on the page as a round trip — while a real round
 * trip with connections shows its outbound half twice and never shows the way home
 * at all.
 *
 * The cases below pin both shapes, the declared split the booking page sends, and
 * the derived split used by a caller that only has `flightIds`.
 */

import { describe, expect, it } from "vitest";
import { buildFlightLegs, splitFlightDirections } from "@/lib/reservations";
import type { AfsFlight } from "@/types";

/** A leg between two airports, leaving and landing at the given times. */
function leg(
	origin: string,
	destination: string,
	departureTime: string,
	arrivalTime: string
): AfsFlight {
	return {
		id: `${origin}-${destination}-${departureTime}`,
		airline: { code: "AC", name: "Air Canada" },
		departureTime,
		arrivalTime,
		origin: { code: origin, name: origin, city: origin, country: "" },
		destination: { code: destination, name: destination, city: destination, country: "" },
		price: 100,
		availableSeats: 9,
		status: "SCHEDULED",
	} as AfsFlight;
}

/**
 * The two journeys these cases are built around.
 *
 * `oneWayConnection` is a connecting one-way ticket, `roundTrip` is a round trip
 * whose outbound (YYZ→HKG→CAN) and return (CAN→DXB→YYZ) each change planes: the
 * outbound is one direction, so it is recorded as leaving Toronto and landing in
 * Guangzhou, not as "outbound YYZ→HKG, return HKG→CAN".
 */
const oneWayConnection = [
	leg("YYZ", "HKG", "2026-10-07T15:20:00.000Z", "2026-10-08T07:20:00.000Z"),
	leg("HKG", "CAN", "2026-10-08T08:40:00.000Z", "2026-10-08T09:35:00.000Z"),
];

const roundTrip = [
	...oneWayConnection,
	leg("CAN", "DXB", "2026-10-10T12:50:00.000Z", "2026-10-11T05:55:00.000Z"),
	leg("DXB", "YYZ", "2026-10-11T08:55:00.000Z", "2026-10-11T20:30:00.000Z"),
];

describe("splitFlightDirections", () => {
	it("keeps a connecting one-way as one direction", () => {
		const directions = splitFlightDirections(oneWayConnection);

		expect(directions.outbound).toEqual(oneWayConnection);
		expect(directions.inbound).toBeUndefined();
	});

	it("splits a connecting round trip at the stay, not at the first connection", () => {
		const directions = splitFlightDirections(roundTrip);

		expect(directions.outbound).toEqual(roundTrip.slice(0, 2));
		expect(directions.inbound).toEqual(roundTrip.slice(2));
	});

	it("honours the split the booking page declares", () => {
		// The stay can be shorter than an overnight connection in the outbound
		// half, which is the case the derivation cannot see from the times alone.
		const overnightConnection = [
			leg("YYZ", "LHR", "2026-10-07T18:00:00.000Z", "2026-10-08T06:00:00.000Z"),
			leg("LHR", "CAN", "2026-10-08T20:00:00.000Z", "2026-10-09T09:00:00.000Z"),
			leg("CAN", "LHR", "2026-10-09T20:00:00.000Z", "2026-10-10T09:00:00.000Z"),
			leg("LHR", "YYZ", "2026-10-10T11:00:00.000Z", "2026-10-10T23:00:00.000Z"),
		];

		const declared = splitFlightDirections(overnightConnection, 2);
		expect(declared.outbound).toEqual(overnightConnection.slice(0, 2));
		expect(declared.inbound).toEqual(overnightConnection.slice(2));
	});

	it("treats a declared count of zero as a one-way booking", () => {
		// An explicit "there is no return half" beats the derivation: a one-way
		// ticket that happens to end where it began is still one direction.
		const directions = splitFlightDirections(roundTrip, 0);

		expect(directions.outbound).toEqual(roundTrip);
		expect(directions.inbound).toBeUndefined();
	});

	it("ignores a declared count that would empty one of the halves", () => {
		// The route answers `400` for these; a direct caller falls back to the
		// derivation rather than being handed a booking with no outbound.
		for (const count of [-1, 4, 99]) {
			const directions = splitFlightDirections(roundTrip, count);
			expect(directions.outbound).toEqual(roundTrip.slice(0, 2));
			expect(directions.inbound).toEqual(roundTrip.slice(2));
		}
	});

	it("halves an itinerary whose times do not point at a stay", () => {
		const synthetic = [
			leg("YYZ", "HKG", "2026-10-07T15:20:00.000Z", "2026-10-07T15:20:00.000Z"),
			leg("HKG", "CAN", "2026-10-07T15:20:00.000Z", "2026-10-07T15:20:00.000Z"),
			leg("CAN", "HKG", "2026-10-07T15:20:00.000Z", "2026-10-07T15:20:00.000Z"),
			leg("HKG", "YYZ", "2026-10-07T15:20:00.000Z", "2026-10-07T15:20:00.000Z"),
		];

		const directions = splitFlightDirections(synthetic);
		expect(directions.outbound).toHaveLength(2);
		expect(directions.inbound).toHaveLength(2);
	});

	it("treats a single leg as one outbound direction", () => {
		const direct = [leg("YYZ", "LHR", "2026-10-07T20:00:00.000Z", "2026-10-08T08:00:00.000Z")];
		const directions = splitFlightDirections(direct);

		expect(directions.outbound).toEqual(direct);
		expect(directions.inbound).toBeUndefined();
	});

	it("treats a one-way that does not come home as one direction", () => {
		// Toronto → Hong Kong → Guangzhou → Dubai never returns to YYZ.
		const onwards = [
			...oneWayConnection,
			leg("CAN", "DXB", "2026-10-10T12:50:00.000Z", "2026-10-11T05:55:00.000Z"),
		];

		expect(splitFlightDirections(onwards).inbound).toBeUndefined();
		expect(splitFlightDirections(onwards).outbound).toEqual(onwards);
	});

	it("returns nothing for an itinerary with no legs", () => {
		expect(splitFlightDirections([])).toEqual({
			outbound: [],
			inbound: undefined,
		});
	});
});

describe("buildFlightLegs", () => {
	/** The stored segment for one of the fixture legs. */
	function stored(flight: AfsFlight) {
		return {
			from: flight.origin.code,
			to: flight.destination.code,
			departDate: flight.departureTime,
			arriveDate: flight.arrivalTime,
		};
	}

	it("names the first and last leg of each direction", () => {
		const legs = buildFlightLegs(splitFlightDirections(roundTrip));

		expect(legs.departure).toEqual({
			goDate: "2026-10-07T15:20:00.000Z",
			goAirport: "YYZ",
			returnDate: "2026-10-10T12:50:00.000Z",
			returnAirport: "CAN",
			goLegs: roundTrip.slice(0, 2).map(stored),
			returnLegs: roundTrip.slice(2).map(stored),
		});
		expect(legs.arrival).toEqual({
			goDate: "2026-10-08T09:35:00.000Z",
			goAirport: "CAN",
			returnDate: "2026-10-11T20:30:00.000Z",
			returnAirport: "YYZ",
			goLegs: roundTrip.slice(0, 2).map(stored),
			returnLegs: roundTrip.slice(2).map(stored),
		});
	});

	it("records every flight of a connecting direction, not just its ends", () => {
		// The transfer airport lives here: the four summary values say only that
		// the journey left YYZ and landed at CAN, which reads as a non-stop flight.
		const legs = buildFlightLegs(splitFlightDirections(oneWayConnection));

		expect(legs.departure.goLegs).toEqual(oneWayConnection.map(stored));
		expect(legs.departure.goLegs?.[0]?.to).toBe("HKG");
		expect(legs.departure.goLegs?.[1]?.from).toBe("HKG");
	});

	it("leaves the return keys null for a one-way booking", () => {
		const legs = buildFlightLegs(splitFlightDirections(oneWayConnection));

		expect(legs.departure).toEqual({
			goDate: "2026-10-07T15:20:00.000Z",
			goAirport: "YYZ",
			returnDate: null,
			returnAirport: null,
			goLegs: oneWayConnection.map(stored),
			returnLegs: [],
		});
		expect(legs.arrival).toEqual({
			goDate: "2026-10-08T09:35:00.000Z",
			goAirport: "CAN",
			returnDate: null,
			returnAirport: null,
			goLegs: oneWayConnection.map(stored),
			returnLegs: [],
		});
	});

	it("writes null rather than a nonsense value for an unusable timestamp", () => {
		const broken = [
			{ ...oneWayConnection[0]!, departureTime: "not a time", arrivalTime: "" },
		];
		const legs = buildFlightLegs(splitFlightDirections(broken));

		expect(legs.departure.goDate).toBeNull();
		expect(legs.arrival.goDate).toBeNull();
		expect(legs.departure.goAirport).toBe("YYZ");
		expect(legs.departure.goLegs?.[0]).toEqual({
			from: "YYZ",
			to: "HKG",
			departDate: null,
			arriveDate: null,
		});
	});

	it("writes null for a booking with no legs at all", () => {
		expect(buildFlightLegs(splitFlightDirections([]))).toEqual({
			departure: {
				goDate: null,
				goAirport: null,
				returnDate: null,
				returnAirport: null,
				goLegs: [],
				returnLegs: [],
			},
			arrival: {
				goDate: null,
				goAirport: null,
				returnDate: null,
				returnAirport: null,
				goLegs: [],
				returnLegs: [],
			},
		});
	});
});
