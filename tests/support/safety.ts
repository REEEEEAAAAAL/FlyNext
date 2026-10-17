import type { PrismaClient } from "@prisma/client";
import { assertTestDatabaseIdentity } from "../../lib/database-safety";
export async function verifyTestDatabase(prisma: PrismaClient): Promise<void> {
	await assertTestDatabaseIdentity(
		() => prisma.$queryRawUnsafe<Array<{ name: string; marker: string | null }>>(
			`SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker
			 FROM pg_database WHERE datname = current_database()`
		), process.env
	);
}
