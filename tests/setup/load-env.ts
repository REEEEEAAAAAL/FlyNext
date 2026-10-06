/**
 * Load the test environment before any suite or handler module is imported.
 *
 * Node does not read `.env` files, and the application modules expect their
 * configuration to already be in `process.env` by the time they run (`lib/auth.ts`
 * reads its secrets lazily, but per call). Loading `.env.test` here — rather than
 * `.env` — is what keeps the suite off the development database: `next dev` and
 * the `prisma` scripts both load `.env`, so an accidental overlap would otherwise
 * be invisible.
 */

import { resolve } from "node:path";
import { loadEnvFile } from "./env-file";

const envPath = resolve(process.cwd(), ".env.test");

let loaded: Record<string, string>;
try {
	loaded = loadEnvFile(envPath);
} catch {
	throw new Error(
		`Could not read ${envPath}. Copy .env.example to .env.test and point ` +
			"DATABASE_URL at a scratch database whose name ends in _test."
	);
}

/** Suites that are not testing the limiter should not have to spend its budget. */
process.env.RATE_LIMIT_DISABLED = "1";

/** Fail loudly rather than silently reaching a database that holds real data. */
const databaseUrl = loaded.DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const databaseName = /^postgresql:\/\/[^/]+\/([^?]+)/.exec(databaseUrl)?.[1] ?? "";

/**
 * `true` when the configured database is a scratch database it is safe to wipe.
 *
 * A dedicated database rather than a dedicated schema inside the development one:
 * the test suite truncates tables, and a schema parameter is far too easy to drop
 * from a connection string by accident.
 */
export const IsTestDatabase = databaseName.endsWith("_test");

if (!IsTestDatabase) {
	throw new Error(
		`Refusing to run: DATABASE_URL points at "${databaseName || "unknown"}", ` +
			"which does not end in _test."
	);
}

/** Exposed for diagnostics when a suite cannot connect. */
export const TEST_DATABASE_NAME = databaseName;
