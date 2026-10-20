/** Owns ONLY the ignored .local-test-db cluster; never reads .env/.env.test. */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertDisposableDatabase } from "../lib/database-safety";

const root = resolve(__dirname, "..");
const stateDir = join(root, ".local-test-db");
const dataDir = join(stateDir, "data");
const envFile = join(root, ".env.test.local");
const stateFile = join(stateDir, "identity.json");
const action = process.argv[2];

function run(name: string, args: string[], password?: string, allowFailure = false): string {
	const executable = process.env.FLYNEXT_PG_BIN ? join(process.env.FLYNEXT_PG_BIN, name) : name;
	const result = spawnSync(executable, args, {
		cwd: root, encoding: "utf8", windowsHide: true, timeout: 45_000,
		// A detached Windows server must not inherit pipes held by spawnSync.
		stdio: name === "pg_ctl" && args.includes("start") ? "ignore" : "pipe",
		env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
	});
	if (result.error || result.status !== 0) {
		if (allowFailure) return "";
		// PostgreSQL CLI output does not include PGPASSWORD; never print env/URL.
		throw new Error(`${name} failed: ${result.error?.message ?? result.stderr?.trim() ?? "see .local-test-db/server.log"}`);
	}
	return result.stdout?.trim() ?? "";
}

function readLocalEnvironment(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
		const match = /^([A-Z_]+)="([^"]*)"$/.exec(line);
		if (match) env[match[1]] = match[2];
	}
	assertDisposableDatabase({ ...process.env, ...env }, "integration");
	const state = JSON.parse(readFileSync(stateFile, "utf8")) as { id?: string; dataDir?: string };
	if (state.id !== env.FLYNEXT_TEST_DATABASE_ID || state.dataDir !== dataDir) {
		throw new Error("Local cluster identity mismatch; refusing to control this server.");
	}
	return env;
}

function main(): void {
	if (!["start", "stop", "check"].includes(action ?? "")) throw new Error("Use test:db:start, test:db:stop or test:db:check.");
	if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NETLIFY || process.env.RENDER_SERVICE_ID) {
		throw new Error("Local test database tools cannot run in a production/deployment environment.");
	}
	let newlyCreated = false;
	if (!existsSync(envFile) && !existsSync(stateFile) && !existsSync(dataDir) && action === "start") {
		// Verify tools BEFORE writing configuration. No downloads or existing service changes.
		run("initdb", ["--version"]);
		run("pg_ctl", ["--version"]);
		run("psql", ["--version"]);
		run("createdb", ["--version"]);
		mkdirSync(stateDir, { recursive: true });
		const password = randomBytes(24).toString("hex");
		const id = randomUUID();
		const pwFile = join(stateDir, "init-password");
		writeFileSync(pwFile, password, { flag: "wx", mode: 0o600 });
		try {
			run("initdb", ["-D", dataDir, "-U", "flynext_test", `--pwfile=${pwFile}`, "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
		} finally { unlinkSync(pwFile); }
		writeFileSync(stateFile, JSON.stringify({ id, dataDir }), { flag: "wx", mode: 0o600 });
		const values = {
			DATABASE_URL: `postgresql://flynext_test:${password}@127.0.0.1:55432/flynext_test?schema=public`,
			FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_TEST_DATABASE_ID: id,
			JWT_ACCESS_SECRET: randomBytes(48).toString("hex"), JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
			JWT_ACCESS_TOKEN_EXPIRY_TIME: "1h", JWT_REFRESH_TOKEN_EXPIRY_TIME: "7d",
			AFS_MOCK: "true", CLOUDINARY_URL: "", CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
		};
		writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}="${value}"`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
		newlyCreated = true;
	}
	if (!existsSync(envFile) || !existsSync(stateFile) || !existsSync(join(dataDir, "PG_VERSION"))) {
		throw new Error("Missing or partially initialized local cluster. Existing files were preserved; inspect .local-test-db before recovery.");
	}
	const env = readLocalEnvironment();
	const password = new URL(env.DATABASE_URL).password;
	if (action === "stop") {
		run("pg_ctl", ["-D", dataDir, "-w", "-t", "30", "stop", "-m", "fast"]);
		console.log("Dedicated local test cluster stopped; data and credentials preserved.");
		return;
	}
	if (action === "start" && !run("pg_ctl", ["-D", dataDir, "status"], undefined, true)) {
		run("pg_ctl", ["-D", dataDir, "-l", join(stateDir, "server.log"), "-o", "-h 127.0.0.1 -p 55432", "-w", "-t", "30", "start"]);
	}
	const connection = ["-h", "127.0.0.1", "-p", "55432", "-U", "flynext_test"];
	// Create/mark only the new cluster. Restarts never mark an existing database as disposable.
	if (newlyCreated || !existsSync(join(stateDir, "database-created"))) {
		if (action !== "start") throw new Error("Database setup is incomplete; check never creates or marks a database.");
		const exists = run("psql", [...connection, "-d", "postgres", "-At", "-c", "SELECT 1 FROM pg_database WHERE datname = 'flynext_test'"], password);
		if (exists) throw new Error("An unmarked test database already exists; refusing to adopt or clear it.");
		run("createdb", [...connection, "flynext_test"], password);
		run("psql", [...connection, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `COMMENT ON DATABASE flynext_test IS 'flynext-disposable-test:${env.FLYNEXT_TEST_DATABASE_ID}'`], password);
		writeFileSync(join(stateDir, "database-created"), "created by FlyNext test-db\n", { flag: "wx" });
	}
	const actual = run("psql", [...connection, "-d", "flynext_test", "-At", "-c", "SELECT current_database() || '|' || shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()"], password);
	if (actual !== `flynext_test|flynext-disposable-test:${env.FLYNEXT_TEST_DATABASE_ID}`) throw new Error("Database identity check failed; no migrations or reset performed.");
	console.log("Verified dedicated PostgreSQL target: loopback:55432/flynext_test; credentials redacted. Existing remote databases untouched.");
}

try { main(); }
catch (error) { console.error(error instanceof Error ? error.message : "Local test database tool failed."); process.exitCode = 1; }
