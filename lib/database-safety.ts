/** Developer-tool guards. A database-name suffix alone is not consent. */
import { createHash } from "node:crypto";
export type OperationEnvironment = Readonly<Record<string, string | undefined>>;
export interface RemoteTestApproval {
	version: 1; fingerprint: string; databaseOid: string; id: string;
}
export function databaseFingerprint(value: string): string {
	const url = new URL(value);
	return createHash("sha256").update(JSON.stringify([
		url.hostname.replace("-pooler.", "."), Number(url.port || 5432),
		decodeURIComponent(url.pathname.slice(1)), decodeURIComponent(url.username),
	])).digest("hex");
}
/** Compare physical database identity, regardless of password, role or pooling. */
export function assertSeparateBusinessDatabases(testUrl: string, businessUrls: string[]): void {
	if (!businessUrls.length) throw new Error("Cannot establish business database exclusion: no business configuration found.");
	const physical = (value: string) => {
		try { const u = new URL(value); return JSON.stringify([u.hostname.replace("-pooler.", "."), Number(u.port || 5432), decodeURIComponent(u.pathname.slice(1))]); }
		catch { throw new Error("Invalid database configuration while checking business exclusion (credentials redacted)."); }
	};
	if (businessUrls.some(value => physical(value) === physical(testUrl))) {
		throw new Error("Test target matches a configured business database; refusing reset.");
	}
}
export interface DisposableDatabaseTarget { host: string; port: number; name: string }

export function assertDisposableDatabase(env: OperationEnvironment, purpose: "integration" | "seed", approval?: RemoteTestApproval): DisposableDatabaseTarget {
	if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV || env.NETLIFY || env.RENDER_SERVICE_ID) {
		throw new Error("Database reset refused in a production/deployment environment.");
	}
	if (env.FLYNEXT_ALLOW_DATABASE_RESET !== "1") {
		throw new Error("Database reset refused: explicit disposable database reset consent is required.");
	}
	let url: URL;
	try { url = new URL(env.DATABASE_URL ?? ""); }
	catch { throw new Error("Database reset refused: invalid DATABASE_URL (credentials redacted)."); }
	if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Database reset refused: PostgreSQL is required.");
	if (url.hash || !url.username || !url.password) throw new Error("Database reset refused: explicit credentials and an unambiguous connection URL are required.");
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (!local && (purpose !== "integration" || env.NODE_ENV !== "test" ||
		!/^ep-[a-z0-9-]+\.[a-z0-9-]+\.(?:aws|azure)\.neon\.tech$/.test(url.hostname) ||
		!approval || approval.version !== 1 || approval.fingerprint !== databaseFingerprint(url.href) ||
		!/^\d+$/.test(approval.databaseOid) || approval.id !== env.FLYNEXT_TEST_DATABASE_ID ||
		!["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? ""))) {
		throw new Error("Database reset refused: remote target requires exact Neon enrollment, test environment and TLS.");
	}
	const allowed = new Set(["schema", "sslmode", "connection_limit", "pool_timeout", "connect_timeout", "pgbouncer", "channel_binding"]);
	const seen = new Set<string>();
	for (const [key, value] of url.searchParams) {
		if (seen.has(key) || !allowed.has(key) || (key === "schema" && value !== "public") ||
			(key === "pgbouncer" && value !== "true") || (key === "channel_binding" && value !== "require")) {
			throw new Error("Database reset refused: unsupported connection routing/schema parameter.");
		}
		seen.add(key);
	}
	const name = url.pathname.slice(1);
	if (!/^flynext(?:_[a-z0-9]+)*_(test|demo)$/.test(name)) throw new Error("Database reset refused: use a disposable flynext_*_test or flynext_*_demo database.");
	const port = Number(url.port || "5432");
	if (purpose === "integration") {
		if (name !== "flynext_test" || (local ? port !== 55432 || url.username !== "flynext_test" : port !== 5432)) {
			throw new Error("Integration tests require flynext_test on loopback port 55432 with the dedicated flynext_test role.");
		}
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.FLYNEXT_TEST_DATABASE_ID ?? "")) {
			throw new Error("Integration tests require the disposable database identity created by test:db:start.");
		}
	}
	return { host: url.hostname, port, name };
}

export interface TestDatabaseIdentity { name: string; marker: string | null; oid?: string; role?: string }
export async function assertTestDatabaseIdentity(query: () => Promise<TestDatabaseIdentity[]>, env: OperationEnvironment, approval?: RemoteTestApproval): Promise<void> {
	const target = assertDisposableDatabase(env, "integration", approval);
	const rows = await query();
	if (rows.length !== 1 || rows[0]?.name !== target.name || rows[0]?.marker !== `flynext-disposable-test:${env.FLYNEXT_TEST_DATABASE_ID}` ||
		(approval && (rows[0].oid !== approval.databaseOid || rows[0].role !== decodeURIComponent(new URL(env.DATABASE_URL!).username)))) {
		throw new Error("Integration database identity mismatch; refusing migrations and TRUNCATE.");
	}
}
