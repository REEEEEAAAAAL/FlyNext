/** Developer-tool guards. A database-name suffix alone is not consent. */
export type OperationEnvironment = Readonly<Record<string, string | undefined>>;
export interface DisposableDatabaseTarget { host: string; port: number; name: string }

export function assertDisposableDatabase(env: OperationEnvironment, purpose: "integration" | "seed"): DisposableDatabaseTarget {
	if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV || env.NETLIFY || env.RENDER_SERVICE_ID) {
		throw new Error("Database reset refused in a production/deployment environment.");
	}
	if (env.FLYNEXT_ALLOW_DATABASE_RESET !== "1") {
		throw new Error("Database reset refused: FLYNEXT_ALLOW_DATABASE_RESET=1 is required for disposable local data.");
	}
	let url: URL;
	try { url = new URL(env.DATABASE_URL ?? ""); }
	catch { throw new Error("Database reset refused: invalid DATABASE_URL (credentials redacted)."); }
	if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Database reset refused: PostgreSQL is required.");
	if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
		throw new Error("Database reset refused: only a literal loopback database host is allowed.");
	}
	const allowed = new Set(["schema", "sslmode", "connection_limit", "pool_timeout", "connect_timeout"]);
	for (const [key, value] of url.searchParams) {
		if (!allowed.has(key) || (key === "schema" && value !== "public")) {
			throw new Error("Database reset refused: unsupported connection routing/schema parameter.");
		}
	}
	const name = url.pathname.slice(1);
	if (!/^flynext(?:_[a-z0-9]+)*_(test|demo)$/.test(name)) throw new Error("Database reset refused: use a disposable flynext_*_test or flynext_*_demo database.");
	const port = Number(url.port || "5432");
	if (purpose === "integration") {
		if (name !== "flynext_test" || port !== 55432 || url.username !== "flynext_test") {
			throw new Error("Integration tests require flynext_test on loopback port 55432 with the dedicated flynext_test role.");
		}
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.FLYNEXT_TEST_DATABASE_ID ?? "")) {
			throw new Error("Integration tests require the disposable database identity created by test:db:start.");
		}
	}
	return { host: url.hostname, port, name };
}

export async function assertTestDatabaseIdentity(query: () => Promise<Array<{ name: string; marker: string | null }>>, env: OperationEnvironment): Promise<void> {
	const target = assertDisposableDatabase(env, "integration");
	const rows = await query();
	if (rows.length !== 1 || rows[0]?.name !== target.name || rows[0]?.marker !== `flynext-disposable-test:${env.FLYNEXT_TEST_DATABASE_ID}`) {
		throw new Error("Integration database identity mismatch; refusing migrations and TRUNCATE.");
	}
}
