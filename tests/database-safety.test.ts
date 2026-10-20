import { describe, expect, it, vi } from "vitest";
import { assertDisposableDatabase, assertTestDatabaseIdentity, assertSeparateBusinessDatabases, databaseFingerprint } from "@/lib/database-safety";
import { migrationDatabaseUrl, remoteApproval } from "./setup/test-target";
import { assertCiDatabaseTarget, ciBusinessDatabaseUrls } from "@/lib/ci-database-safety";

const id = "a1111111-1111-4111-8111-111111111111";
const safe = {
	NODE_ENV: "test", DATABASE_URL: "postgresql://flynext_test:synthetic@127.0.0.1:55432/flynext_test?schema=public",
	FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_TEST_DATABASE_ID: id,
};

describe("CI database isolation configuration", () => {
	const host = "ep-ci-example.us-east-2.aws.neon.tech";
	const url = `postgresql://flynext_ci_runner:synthetic@${host}/flynext_test?sslmode=require`;
	it("accepts only the explicitly allowlisted endpoint and CI role", () => {
		const env = { CI_TEST_DATABASE_HOST: host };
		expect(() => assertCiDatabaseTarget(url, env)).not.toThrow();
		expect(() => assertCiDatabaseTarget(url.replace(host, host.replace(".us-", "-pooler.us-")), env)).not.toThrow();
		for (const changed of [url.replace("ci-example", "another-example"), url.replace("flynext_ci_runner", "admin")]) {
			expect(() => assertCiDatabaseTarget(changed, env)).toThrow();
		}
		expect(() => assertCiDatabaseTarget(url, {})).toThrow();
		expect(() => assertCiDatabaseTarget(url, { CI_TEST_DATABASE_HOST: host.replace(".us-", "-pooler.us-") })).toThrow();
	});
	it.each([undefined, "invalid", "[]", "{}", '[null]', '[{"host":"invalid","database":"flynextdb"}]',
		JSON.stringify([{ host, database: "flynextdb", password: "do-not-print" }])])("rejects missing or malformed exclusion metadata without disclosing values", value => {
		expect(() => ciBusinessDatabaseUrls(value)).toThrow("credential-free");
		try { ciBusinessDatabaseUrls(value); } catch (error) { expect(String(error)).not.toContain("do-not-print"); }
	});
	it("preserves physical exclusion across pooled and direct endpoints", () => {
		const excluded = ciBusinessDatabaseUrls(JSON.stringify([{ host: host.replace(".us-", "-pooler.us-"), database: "flynext_test" }]));
		expect(() => assertSeparateBusinessDatabases(url, excluded)).toThrow("business database");
		expect(() => assertSeparateBusinessDatabases(url.replace("ci-example", "other-example"), excluded)).not.toThrow();
	});
	it("requires CI metadata even when local business files might exist", () => {
		vi.stubEnv("CI", "true");
		vi.stubEnv("CI_TEST_DATABASE_HOST", host);
		vi.stubEnv("CI_BUSINESS_DATABASE_TARGETS", "[]");
		try { expect(() => remoteApproval(url)).toThrow("credential-free"); }
		finally { vi.unstubAllEnvs(); }
	});
});

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

describe("enrolled remote Neon boundaries", () => {
	it("redacts malformed URLs before enrollment lookup or migration parsing", () => {
		for (const parse of [remoteApproval, migrationDatabaseUrl]) {
			try { parse("postgresql://user:do-not-print@"); throw new Error("expected refusal"); }
			catch (error) {
				expect(String(error)).toContain("credentials redacted");
				expect(String(error)).not.toContain("do-not-print");
			}
		}
	});
	const url = "postgresql://test_role:synthetic@ep-test-123-pooler.us-east-2.aws.neon.tech/flynext_test?sslmode=require";
	const env = { ...safe, DATABASE_URL: url };
	const approval = { version: 1 as const, fingerprint: databaseFingerprint(url), databaseOid: "12345", id };
	it("accepts the exact enrolled test target and its same-database direct connection", () => {
		expect(assertDisposableDatabase(env, "integration", approval).name).toBe("flynext_test");
		expect(databaseFingerprint(migrationDatabaseUrl(url))).toBe(approval.fingerprint);
	});
	it.each([
		{ NODE_ENV: "development" }, { NODE_ENV: "production" }, { VERCEL_ENV: "preview" },
		{ FLYNEXT_ALLOW_DATABASE_RESET: undefined }, { FLYNEXT_TEST_DATABASE_ID: "different" },
		{ DATABASE_URL: url.replace("require", "disable") },
		{ DATABASE_URL: url.replace("test-123", "other-123") },
		{ DATABASE_URL: url.replace("test_role", "other_role") },
		{ DATABASE_URL: url.replace("flynext_test", "neondb") },
		{ DATABASE_URL: url + "&host=production.invalid" },
		{ DATABASE_URL: url + "&schema=business" },
		{ DATABASE_URL: url + "&sslmode=disable" },
		{ DATABASE_URL: url + "#routing" },
	])("rejects changed environment, endpoint, role, database, TLS and routing", override => {
		expect(() => assertDisposableDatabase({ ...env, ...override }, "integration", approval)).toThrow();
	});
	it("rejects unregistered remote databases and remote demo seed even with consent", () => {
		expect(() => assertDisposableDatabase(env, "integration")).toThrow();
		expect(() => assertDisposableDatabase(env, "seed", approval)).toThrow();
	});
	it("compares business database identity across pooler/direct, passwords and roles", () => {
		const same = migrationDatabaseUrl(url).replace("test_role:synthetic", "business_role:other");
		expect(() => assertSeparateBusinessDatabases(url, [same])).toThrow("business database");
		expect(() => assertSeparateBusinessDatabases(url, [])).toThrow();
		expect(() => assertSeparateBusinessDatabases(url, [same.replace("flynext_test", "neondb")])).not.toThrow();
	});
	it("requires marker, actual database OID and connected role before any write", async () => {
		const row = { name: "flynext_test", marker: `flynext-disposable-test:${id}`, oid: "12345", role: "test_role" };
		await expect(assertTestDatabaseIdentity(async () => [row], env, approval)).resolves.toBeUndefined();
		for (const change of [{ oid: "999" }, { role: "other" }, { marker: null }, { name: "neondb" }]) {
			await expect(assertTestDatabaseIdentity(async () => [{ ...row, ...change }], env, approval)).rejects.toThrow("identity mismatch");
		}
	});
});

describe("Neon shard hostname enrollment boundaries", () => {
	const host = "ep-ci-example.c-7.us-east-2.aws.neon.tech";
	const url = `postgresql://flynext_ci_runner:synthetic@${host}/flynext_test?sslmode=require`;
	it("accepts direct and pooled shard hosts with exact identity and TLS", () => {
		for (const value of [url, url.replace(".c-7.", "-pooler.c-7.")]) {
			assertCiDatabaseTarget(value, { CI_TEST_DATABASE_HOST: host });
			const approval = { version: 1 as const, fingerprint: databaseFingerprint(value), databaseOid: "12345", id };
			expect(assertDisposableDatabase({ ...safe, NODE_ENV: "test", DATABASE_URL: value }, "integration", approval).name).toBe("flynext_test");
		}
	});
	it("keeps endpoint, routing, TLS and business exclusion restrictions", () => {
		expect(() => assertCiDatabaseTarget(url, { CI_TEST_DATABASE_HOST: host.replace("c-7", "c-8") })).toThrow();
		const excluded = ciBusinessDatabaseUrls(JSON.stringify([{ host, database: "flynext_test" }]));
		expect(() => assertSeparateBusinessDatabases(url, excluded)).toThrow();
		for (const value of [url.replace("c-7", "c-seven"), url.replace("require", "disable"), `${url}&host=production.invalid`]) {
			const approval = { version: 1 as const, fingerprint: databaseFingerprint(value), databaseOid: "12345", id };
			expect(() => assertDisposableDatabase({ ...safe, NODE_ENV: "test", DATABASE_URL: value }, "integration", approval)).toThrow();
		}
	});
});
