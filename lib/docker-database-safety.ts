import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import type { PrismaClient } from "@prisma/client";
import type { OperationEnvironment } from "./database-safety";

export function assertDockerOperationMode(env: OperationEnvironment, action: string): void {
	if (action === "reset" && env.AFS_MOCK !== "true") {
		throw new Error("Docker reset requires built-in AFS; remote tickets must be reconciled before creating a fresh project.");
	}
}

export function assertDockerDatabaseTarget(env: OperationEnvironment): void {
	let url: URL;
	try { url = new URL(env.DATABASE_URL ?? ""); }
	catch { throw new Error("Docker database configuration is invalid (credentials redacted)."); }
	if (!existsSync("/.dockerenv") || env.VERCEL || env.VERCEL_ENV || env.NETLIFY || env.RENDER_SERVICE_ID ||
		!/^flynext-local-[a-f0-9]{12}$/.test(env.COMPOSE_PROJECT_NAME ?? "") ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(env.FLYNEXT_DOCKER_INSTANCE_ID ?? "") ||
		url.protocol !== "postgresql:" || url.hostname !== "postgres" || url.port !== "5432" ||
		url.pathname !== "/flynext_docker_demo" || url.username !== "flynext_docker" ||
		!url.password || url.hash || url.search !== "?connection_limit=1&connect_timeout=5") {
		throw new Error("Docker database target refused: isolated Compose identity and fixed local routing are required.");
	}
}

export async function assertDockerDatabaseIdentity(db: PrismaClient, env: OperationEnvironment, reset = false): Promise<void> {
	assertDockerDatabaseTarget(env);
	if (reset && (env.NODE_ENV === "production" || env.FLYNEXT_ALLOW_DATABASE_RESET !== "1" ||
		!["initialize", "reset"].includes(env.FLYNEXT_DOCKER_ACTION ?? ""))) {
		throw new Error("Docker reset refused: explicit initialization/reset authorization is required.");
	}
	const addresses = await lookup("postgres", { all: true, family: 4 });
	const rows = await db.$queryRaw<{ name: string; role: string; address: string; port: number; id: string; system_id: string; actual_system_id: string; privileged: boolean }[]>`
		SELECT current_database()::text AS name, session_user::text AS role, host(inet_server_addr()) AS address,
		inet_server_port() AS port, i.*, r.rolsuper OR r.rolcreatedb OR r.rolcreaterole AS privileged
		FROM flynext_local.identity() i JOIN pg_roles r ON r.rolname = session_user`;
	const row = rows[0];
	if (rows.length !== 1 || !row || row.name !== "flynext_docker_demo" || row.role !== "flynext_docker" ||
		row.port !== 5432 || row.privileged || !addresses.some(item => item.address === row.address) ||
		row.id !== env.FLYNEXT_DOCKER_INSTANCE_ID || !/^\d+$/.test(row.system_id) || row.system_id !== row.actual_system_id) {
		throw new Error("Docker database identity mismatch; refusing database operations.");
	}
}
