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
 * load-env rejects unsafe targets before connecting. The database identity is
 * then verified here and at migration/TRUNCATE boundaries before any write.
 */

import { PrismaClient } from "@prisma/client";
import { applyMigrations } from "#support/migrate";
import { verifyTestDatabase } from "#support/safety";

export async function setup(): Promise<void> {
	// Only the newly generated .env.test.local is loaded. Existing remote
	// .env/.env.test configurations are never used by this suite.
	const env = await import("./load-env");

	if (!env.IsTestDatabase) {
		throw new Error(
			`Refusing to run the suite against "${env.TEST_DATABASE_NAME}". ` +
				"Set DATABASE_URL in .env.test to a database whose name ends in _test."
		);
	}

	const prisma = new PrismaClient();
	try {
		await verifyTestDatabase(prisma);
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
