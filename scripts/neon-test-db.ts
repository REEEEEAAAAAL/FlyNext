/** Explicit enrollment, then read-only verification. Never prints connection data. */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { assertDisposableDatabase, assertSeparateBusinessDatabases, databaseFingerprint, type RemoteTestApproval } from "../lib/database-safety";
import { parseEnvFile } from "../tests/setup/env-file";
import { approvalPath, businessDatabaseUrls, migrationDatabaseUrl } from "../tests/setup/test-target";
import { verifyTestDatabase } from "../tests/support/safety";
import { assertCiDatabaseTarget } from "../lib/ci-database-safety";

async function main() {
	if (process.argv[2] === "check") {
		await import("../tests/setup/load-env");
		const client = new PrismaClient({ datasourceUrl: migrationDatabaseUrl(process.env.DATABASE_URL!) });
		try { await verifyTestDatabase(client); console.log("Verified enrolled test database identity and business database exclusion (credentials redacted)."); }
		finally { await client.$disconnect(); }
		return;
	}
	if (process.argv[2] !== "enroll" || process.argv[3] !== "--confirm-reset=flynext_test") {
		throw new Error("Enrollment requires enroll --confirm-reset=flynext_test after explicit authorization to clear that database.");
	}
	if (existsSync(approvalPath)) throw new Error("Enrollment already exists; use test:db:verify. Existing approval was preserved.");
	const file = parseEnvFile(".env.test");
	const env = { ...process.env, ...file };
	// Neither the file nor the shell may hide deployment context.
	for (const source of [process.env, file]) {
		if (source.NODE_ENV === "production" || source.VERCEL || source.VERCEL_ENV || source.NETLIFY || source.RENDER_SERVICE_ID) throw new Error("Enrollment refused in deployment context.");
	}
	const url = new URL(file.DATABASE_URL);
	if (process.env.CI === "true") assertCiDatabaseTarget(url.href, process.env);
	if (!url.hostname.endsWith(".neon.tech")) throw new Error("Enrollment is only for the explicitly designated Neon test database.");
	assertSeparateBusinessDatabases(url.href, businessDatabaseUrls());
	const approval: RemoteTestApproval = { version: 1, fingerprint: databaseFingerprint(url.href), databaseOid: "0", id: randomUUID() };
	Object.assign(env, { NODE_ENV: "test", FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_TEST_DATABASE_ID: approval.id });
	assertDisposableDatabase(env, "integration", approval);
	const client = new PrismaClient({ datasourceUrl: migrationDatabaseUrl(file.DATABASE_URL) });
	try {
		const rows = await client.$queryRawUnsafe<Array<{ name: string; role: string; oid: string; marker: string | null; owner: boolean }>>(
			`SELECT current_database() AS name, current_user AS role, oid::text AS oid,
			 shobj_description(oid, 'pg_database') AS marker, datdba = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner
			 FROM pg_database WHERE datname=current_database()`);
		const actual = rows[0];
		if (rows.length !== 1 || actual.name !== "flynext_test" || actual.role !== decodeURIComponent(url.username) || !actual.owner || actual.marker !== null) {
			throw new Error("Enrollment refused: unexpected database name, role, ownership or existing marker.");
		}
		const allowed = new Set(["BookingRequest", "RefreshSession", "RateLimitCounter", "AfsOfflineBooking", "Airport", "City", "FlightReservation", "Hotel", "HotelReservation", "Itinerary", "Notification", "RoomAvailabilityRecord", "RoomType", "User", "_prisma_migrations"]);
		const tables = await client.$queryRawUnsafe<Array<{ schemaname: string; tablename: string }>>("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')");
		if (tables.some(row => row.schemaname !== "public" || !allowed.has(row.tablename))) throw new Error("Enrollment refused: unexpected non-project tables; inspect target manually.");
		approval.databaseOid = actual.oid;
		// The only enrollment write. No migration, seed or TRUNCATE happens here.
		await client.$executeRawUnsafe(`COMMENT ON DATABASE "flynext_test" IS 'flynext-disposable-test:${approval.id}'`);
		writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n", { flag: "wx", mode: 0o600 });
		console.log("Enrolled exact Neon flynext_test identity; business database excluded. No application data changed.");
	} finally { await client.$disconnect(); }
}
main().catch(error => {
	// Driver errors can contain hosts/URLs. Only our fixed messages are printable.
	console.error(error?.constructor === Error ? error.message : `Neon test database operation failed (${error?.code ?? error?.name ?? "unknown"}); connection details withheld.`);
	process.exitCode = 1;
});
