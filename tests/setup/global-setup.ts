/**
 * Vitest global setup: prepare the scratch database once per run.
 *
 * Two jobs, both of which must happen before any suite imports a handler:
 *
 * 1. Load the test environment, so `DATABASE_URL` names the test database for
 *    this process and everything it spawns.
 * 2. Apply migrations. The suite asserts against real columns and real unique
 *    constraints — the oversell case depends on `updateMany` affecting an exact
 *    number of rows, and one case proves the `(roomTypeId, date)` index exists —
 *    so it runs against the migrated schema rather than an approximation of it.
 *
 * The connection string is checked twice: here, and again when `load-env` is
 * imported. A suite that truncates tables is only safe if pointing it at the
 * development database is impossible, and the check costs nothing.
 */

import { PrismaClient } from "@prisma/client";
import { applyMigrations } from "#support/migrate";

export async function setup(): Promise<void> {
	// Import for its side effect: it loads `.env.test` and rejects any other
	// database name before the first connection is opened.
	const env = await import("./load-env");

	if (!env.IsTestDatabase) {
		throw new Error(
			`Refusing to run the suite against "${env.TEST_DATABASE_NAME}". ` +
				"Set DATABASE_URL in .env.test to a database whose name ends in _test."
		);
	}

	const prisma = new PrismaClient();
	try {
		const applied = await applyMigrations(prisma);
		if (applied.length > 0) {
			console.log(
				`[tests] applied ${applied.length} migration(s) to ` +
					`${env.TEST_DATABASE_NAME}: ${applied.join(", ")}`
			);
		}
	} finally {
		await prisma.$disconnect();
	}
}

export async function teardown(): Promise<void> {
	// Nothing to clean up: the suites truncate the tables they use between cases
	// and the database itself is a dedicated scratch instance.
}
