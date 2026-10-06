/**
 * Bring the test database up to date with `prisma/migrations`.
 *
 * The Prisma CLI is the normal way to do this, but it is a child process spawned
 * per run, which adds a failure mode of its own: the suite then fails before a
 * single assertion runs, for a reason that has nothing to do with the code under
 * test. So the migrations are applied from here instead: read the directory,
 * compare it with what `_prisma_migrations` already records, and run the missing
 * files inside a transaction each.
 *
 * Each file is executed one statement at a time, because `$executeRawUnsafe`
 * parses exactly one statement per call: handing it a whole `migration.sql` fails
 * with SQLSTATE 42601 ("cannot insert multiple commands into a prepared
 * statement"), so every fresh database would fail to migrate. The splitter is
 * shared with the seed scripts (`prisma/sql-script.ts`).
 *
 * The bookkeeping matches what `prisma migrate deploy` writes, so a database
 * prepared by this function is indistinguishable from one prepared by the CLI and
 * either can be used afterwards.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { firstLine, splitSqlStatements } from "../../prisma/sql-script";

/** One directory under `prisma/migrations`. */
interface Migration {
	name: string;
	sql: string;
	checksum: string;
}

/** Directory name format: `20250405024941_init_postgres`. */
const MIGRATION_DIRECTORY = /^\d{14}_[A-Za-z0-9_-]+$/;

/**
 * Budget for applying one migration.
 *
 * The init migration is ~30 DDL statements, and each one is sent on its own, so
 * every one of them is its own round trip. Against the remote database the
 * suite is documented to use, Prisma's five-second default is too tight for that,
 * and the failure would look like a flaky suite rather than a timeout.
 */
const MIGRATION_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

/** Read every migration, in directory-name order (which is chronological). */
function readMigrations(): Migration[] {
	const root = resolve(process.cwd(), "prisma", "migrations");
	return readdirSync(root)
		.filter((entry) => {
			if (!MIGRATION_DIRECTORY.test(entry)) {
				return false;
			}
			return statSync(join(root, entry)).isDirectory();
		})
		.sort()
		.map((name) => {
			const sql = readFileSync(join(root, name, "migration.sql"), "utf8");
			return {
				name,
				sql,
				checksum: createHash("sha256").update(sql).digest("hex"),
			};
		});
}

/** Migration names already recorded as applied. */
async function appliedMigrations(prisma: PrismaClient): Promise<Set<string>> {
	try {
		const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
			'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
		);
		return new Set(rows.map((row) => row.migration_name));
	} catch {
		// No bookkeeping table yet: this is a fresh database.
		return new Set();
	}
}

/**
 * Apply every migration the database has not seen.
 *
 * @returns the names of the migrations applied by this call.
 */
export async function applyMigrations(prisma: PrismaClient): Promise<string[]> {
	const migrations = readMigrations();
	const applied = await appliedMigrations(prisma);
	const pending = migrations.filter((migration) => !applied.has(migration.name));

	if (pending.length === 0) {
		return [];
	}

	await prisma.$executeRawUnsafe(`
		CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
			"id"                  VARCHAR(36)  PRIMARY KEY NOT NULL,
			"checksum"            VARCHAR(64)  NOT NULL,
			"finished_at"         TIMESTAMPTZ,
			"migration_name"      VARCHAR(255) NOT NULL,
			"logs"                TEXT,
			"rolled_back_at"      TIMESTAMPTZ,
			"started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
			"applied_steps_count" INTEGER      NOT NULL DEFAULT 0
		)
	`);

	for (const migration of pending) {
		const statements = splitSqlStatements(migration.sql);

		// Each migration is applied as one transaction and recorded in the same
		// transaction, so a failure leaves neither the schema change nor a claim
		// that it happened.
		await prisma.$transaction(
			async (tx) => {
				await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 0');
				for (let index = 0; index < statements.length; index += 1) {
					const statement = statements[index];
					try {
						// One statement only: `splitSqlStatements` guarantees it.
						await tx.$executeRawUnsafe(statement);
					} catch (error) {
						throw new Error(
							`Migration ${migration.name} failed at statement ${index + 1} ` +
								`of ${statements.length}: ${firstLine(statement)}`,
							{ cause: error }
						);
					}
				}
				await tx.$executeRawUnsafe(
					`INSERT INTO "_prisma_migrations"
						("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
					 VALUES (gen_random_uuid()::text, $1, now(), $2, 1)`,
					migration.checksum,
					migration.name
				);
			},
			{ timeout: MIGRATION_TRANSACTION_TIMEOUT_MS }
		);
	}

	return pending.map((migration) => migration.name);
}
