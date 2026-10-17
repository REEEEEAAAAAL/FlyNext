import { describe, expect, it, vi } from "vitest";
import { assertDisposableDatabase, assertTestDatabaseIdentity } from "@/lib/database-safety";

const id = "a1111111-1111-4111-8111-111111111111";
const safe = {
	NODE_ENV: "test", DATABASE_URL: "postgresql://flynext_test:synthetic@127.0.0.1:55432/flynext_test?schema=public",
	FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_TEST_DATABASE_ID: id,
};

describe("destructive database tool boundaries", () => {
	it("accepts only the explicitly opted-in dedicated local integration target", () => {
		expect(assertDisposableDatabase(safe, "integration")).toEqual({ host: "127.0.0.1", port: 55432, name: "flynext_test" });
	});
	it.each([
		{ NODE_ENV: "production" }, { VERCEL: "1" }, { VERCEL_ENV: "preview" },
		{ FLYNEXT_ALLOW_DATABASE_RESET: undefined }, { FLYNEXT_TEST_DATABASE_ID: undefined },
		{ DATABASE_URL: "postgresql://flynext_test:synthetic@remote.invalid:55432/flynext_test" },
		{ DATABASE_URL: "postgresql://flynext_test:synthetic@127.0.0.1:5432/flynext_test" },
		{ DATABASE_URL: "postgresql://flynext_test:synthetic@127.0.0.1:55432/flynext" },
		{ DATABASE_URL: "postgresql://other:synthetic@127.0.0.1:55432/flynext_test" },
		{ DATABASE_URL: `${safe.DATABASE_URL}&host=remote.invalid` },
		{ DATABASE_URL: `${safe.DATABASE_URL}&schema=business` },
		{ DATABASE_URL: "postgresql://secret:do-not-print@" },
	])("rejects an unsafe target/config before a connection", (override) => {
		expect(() => assertDisposableDatabase({ ...safe, ...override }, "integration")).toThrow();
	});
	it("never includes connection credentials in rejection messages", () => {
		try { assertDisposableDatabase({ ...safe, DATABASE_URL: "postgresql://user:do-not-print@remote.invalid/flynext_test" }, "integration"); }
		catch (error) { expect(String(error)).not.toContain("do-not-print"); }
	});
	it("rejects seed against remote or production even when reset opt-in is set", () => {
		expect(() => assertDisposableDatabase({ ...safe, NODE_ENV: "production" }, "seed")).toThrow();
		expect(() => assertDisposableDatabase({ ...safe, DATABASE_URL: "postgresql://user:synthetic@remote.invalid/flynext_demo" }, "seed")).toThrow();
	});
	it("accepts a local disposable demo seed with explicit opt-in", () => {
		expect(assertDisposableDatabase({ ...safe, DATABASE_URL: "postgresql://user:synthetic@localhost/flynext_demo" }, "seed").name).toBe("flynext_demo");
	});
	it("rejects an unmarked or differently marked database", async () => {
		for (const marker of [null, "unrelated", "flynext-disposable-test:other"]) {
			await expect(assertTestDatabaseIdentity(async () => [{ name: "flynext_test", marker }], safe)).rejects.toThrow("identity mismatch");
		}
	});
	it("does not query at all when pre-connection validation fails", async () => {
		const query = vi.fn(async () => []);
		await expect(assertTestDatabaseIdentity(query, { ...safe, FLYNEXT_ALLOW_DATABASE_RESET: undefined })).rejects.toThrow();
		expect(query).not.toHaveBeenCalled();
	});
	it("accepts the independently verified database identity", async () => {
		await expect(assertTestDatabaseIdentity(async () => [{ name: "flynext_test", marker: `flynext-disposable-test:${id}` }], safe)).resolves.toBeUndefined();
	});
});
