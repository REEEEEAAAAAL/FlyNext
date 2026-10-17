import type { PrismaClient } from "@prisma/client";
import { assertTestDatabaseIdentity } from "../../lib/database-safety";
import { remoteApproval } from "../setup/test-target";
export async function verifyTestDatabase(prisma: PrismaClient): Promise<void> {
	await assertTestDatabaseIdentity(
		() => prisma.$queryRawUnsafe<Array<{ name: string; marker: string | null; oid: string; role: string }>>(
			`SELECT current_database() AS name, oid::text AS oid, current_user AS role, shobj_description(oid, 'pg_database') AS marker
			 FROM pg_database WHERE datname = current_database()`
		), process.env, remoteApproval(process.env.DATABASE_URL ?? "")
	);
}
