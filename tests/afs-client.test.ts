import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), create: vi.fn() }));
vi.mock("axios", () => ({ default: { create: http.create, isAxiosError: (value: unknown) =>
  typeof value === "object" && value !== null && "isAxiosError" in value } }));
vi.mock("@/lib/afs/offline", () => ({
  noteOfflineMode: vi.fn(), offlineStats: vi.fn(), getCities: vi.fn(), getAirports: vi.fn(),
  getAirlines: vi.fn(), searchFlights: vi.fn(), createBooking: vi.fn(),
  retrieveBooking: vi.fn(), cancelBooking: vi.fn(),
}));
import { cancelFlight, createBooking, retrieveBooking, searchFlights } from "@/lib/afs-client";
import { resolveAfsMode } from "@/lib/afs/config";

const airport = { code: "YYZ", name: "Toronto", city: "Toronto", country: "Canada" };
const flight = { id: "synthetic-leg", airline: { code: "AC", name: "Air Canada" },
  departureTime: "2030-01-01T00:00:00Z", arrivalTime: "2030-01-01T07:00:00Z",
  origin: airport, destination: { ...airport, code: "LHR" }, duration: 420,
  price: 123.45, currency: "USD", availableSeats: 100, status: "SCHEDULED" };
const params = { origin: "YYZ", destination: "LHR", date: "2030-01-01" };

beforeEach(() => {
  vi.stubEnv("AFS_MOCK", "false");
  vi.stubEnv("AFS_BASE_URL", "http://afs:3000");
  vi.stubEnv("AFS_API_KEY", "synthetic-unit-key");
  http.create.mockReturnValue(http);
  http.get.mockReset(); http.post.mockReset(); http.create.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("remote AFS boundary", () => {
	it("sends the durable operation key on remote booking requests", async () => {
		http.post.mockResolvedValue({ data: { bookingReference: "AFS-FULL-REFERENCE", status: "CONFIRMED", flights: [flight] } });
		const payload = { firstName: "Demo", lastName: "Traveller", email: "test@example.invalid", passportNumber: "DEMO-PASSENGER", flightIds: [flight.id] };
		await createBooking(payload, "durable-operation");
		expect(http.post).toHaveBeenCalledWith("/api/bookings", payload, { headers: { "Idempotency-Key": "durable-operation" } });
	});
  it("normalizes the pinned provider's numeric duration and absent group price", async () => {
    http.get.mockResolvedValue({ data: { results: [{ legs: 1, flights: [flight] }] } });
    const groups = await searchFlights(params);
    expect(groups[0].totalPrice).toBe(123.45);
    expect(groups[0].flights[0].durationMinutes).toBe(420);
    expect(groups[0].flights[0].duration).toBeUndefined();
  });
  it("rejects malformed prices instead of creating a zero-price booking", async () => {
    http.get.mockResolvedValue({ data: { results: [{ flights: [{ ...flight, price: "123" }] }] } });
    await expect(searchFlights(params)).rejects.toMatchObject({ status: 502 });
  });
  it("keeps the upstream short reference when its response omits an id", async () => {
    const booking = { bookingReference: "ABC123", status: "CONFIRMED", flights: [flight] };
    http.post.mockResolvedValue({ data: booking });
    const created = await createBooking({ firstName: "Synthetic", lastName: "Traveller",
      email: "unit@example.invalid", passportNumber: "DEMO-PASSENGER", flightIds: [flight.id] });
    expect(created.bookingReference).toBe("ABC123");
    expect(created.id).toBeUndefined();
    http.get.mockResolvedValue({ data: booking });
    expect((await retrieveBooking("Traveller", "ABC123")).status).toBe("CONFIRMED");
    http.post.mockResolvedValue({ data: { ...booking, status: "CANCELLED" } });
    expect((await cancelFlight("ABC123", "Traveller")).status).toBe("CANCELLED");
  });
  it.each([401, 403, 500, "ETIMEDOUT"])("maps provider failure %s to a redacted gateway error", async code => {
    http.get.mockRejectedValue({ isAxiosError: true, response: typeof code === "number" ? { status: code } : undefined,
      code, config: { headers: { "x-api-key": "must-never-leak" } } });
    await expect(searchFlights(params)).rejects.toMatchObject({ status: 502, message: "Flight search failed" });
  });
  it("fails explicitly when required remote configuration is unusable", async () => {
    vi.stubEnv("AFS_BASE_URL", "https://afs.invalid");
    expect(resolveAfsMode().mode).toBe("remote");
    await expect(searchFlights(params)).rejects.toMatchObject({ status: 502 });
    expect(http.get).not.toHaveBeenCalled();
  });
  it("keeps forced offline precedence and the default built-in mode", () => {
    vi.stubEnv("AFS_MOCK", "true");
    expect(resolveAfsMode().mode).toBe("offline");
    vi.stubEnv("AFS_MOCK", "");
    vi.stubEnv("AFS_BASE_URL", "");
    expect(resolveAfsMode().mode).toBe("offline");
  });
  it("refreshes authentication when the key changes on the same base URL", async () => {
    http.get.mockResolvedValue({ data: { results: [] } });
    await searchFlights(params);
    vi.stubEnv("AFS_API_KEY", "rotated-synthetic-unit-key");
    await searchFlights(params);
    expect(http.create).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ "x-api-key": "rotated-synthetic-unit-key" }),
    }));
  });
});
