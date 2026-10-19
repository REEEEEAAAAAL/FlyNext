import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSeparateBusinessDatabases, type RemoteTestApproval } from "../../lib/database-safety";
import { parseEnvFile } from "./env-file";

export const approvalPath = resolve(process.cwd(), ".neon-test-approval.json");
export function businessDatabaseUrls(): string[] {
	const urls: string[] = [];
	for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".database-maintenance/production.env", ".database-maintenance/production-migration.env"]) {
		if (!existsSync(name)) continue;
		const env = parseEnvFile(name);
		for (const key of ["DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"]) {
			if (env[key]) urls.push(env[key]);
		}
	}
	return urls;
}
export function remoteApproval(databaseUrl: string): RemoteTestApproval | undefined {
	let url: URL;
	try { url = new URL(databaseUrl); }
	catch { throw new Error("Invalid test DATABASE_URL (credentials redacted)."); }
	if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return undefined;
	assertSeparateBusinessDatabases(databaseUrl, businessDatabaseUrls());
	if (!existsSync(approvalPath)) throw new Error("Neon test target is not enrolled. See docs/DEVELOPMENT.md; no writes performed.");
	return JSON.parse(readFileSync(approvalPath, "utf8")) as RemoteTestApproval;
}
/** Same Neon endpoint/database/role; bypass PgBouncer only for setup/DDL. */
export function migrationDatabaseUrl(databaseUrl: string): string {
	let url: URL;
	try { url = new URL(databaseUrl); }
	catch { throw new Error("Invalid migration database configuration (credentials redacted)."); }
	if (url.hostname.endsWith(".neon.tech")) {
		url.hostname = url.hostname.replace("-pooler.", ".");
		url.searchParams.delete("pgbouncer");
	}
	return url.href;
}
