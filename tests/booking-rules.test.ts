import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get() { throw new Error("Pure tests must not access Prisma"); } }), DEFAULT_TRANSACTION_OPTIONS: {} }));
import { eachNight, parseDateOnly, parseStayRange } from "@/lib/api/validation";
import { assertAllLegsScheduled } from "@/lib/reservations";
import type { AfsFlight } from "@/types";
import { formatStayDate } from "@/app/lib/booking-display";

describe("UTC hotel calendar and all-leg flight verification", () => {
	for (const zone of ["UTC", "Asia/Shanghai", "America/Toronto"]) {
		it(`keeps DST stay dates stable in ${zone}`, () => {
			const previous = process.env.TZ;
			try {
				process.env.TZ = zone;
				for (const [start, end] of [["2026-03-07", "2026-03-10"], ["2026-10-31", "2026-11-03"]]) {
					const stay = parseStayRange(start, end);
					expect(stay.nights).toBe(3);
					expect(eachNight(stay.checkIn, stay.checkOut)).toHaveLength(3);
					expect(parseDateOnly(start, "date").toISOString()).toBe(`${start}T00:00:00.000Z`);
					expect(formatStayDate(`${start}T00:00:00.000Z`)).toBe(new Date(`${start}T12:00:00.000Z`).toLocaleDateString());
				}
			} finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
		});
	}
	it("rejects a cancelled third or fourth segment and an empty schedule", () => {
		for (const index of [2, 3]) {
			const flights = Array.from({ length: 4 }, (_, i) => ({ id: `leg-${i}`, status: i === index ? "CANCELLED" : "SCHEDULED" } as AfsFlight));
			expect(() => assertAllLegsScheduled({ status: "CONFIRMED", flights })).toThrow(`leg-${index}`);
		}
		expect(() => assertAllLegsScheduled({ status: "CONFIRMED", flights: [] })).toThrow("schedule is unavailable");
	});
});
