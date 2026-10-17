import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisposableDatabase } from "../../lib/database-safety";
import { parseEnvFile } from "./env-file";
import { remoteApproval } from "./test-target";

// Check before a file could overwrite deployment flags.
if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NETLIFY || process.env.RENDER_SERVICE_ID) {
	throw new Error("Integration tests are forbidden in a production/deployment environment.");
}
const filename = process.env.FLYNEXT_TEST_ENV === "local" ? ".env.test.local" : ".env.test";
const envPath = resolve(process.cwd(), filename);
if (!existsSync(envPath)) throw new Error(`Missing ${filename}. See docs/DEVELOPMENT.md.`);
const loaded = parseEnvFile(envPath);
if (!loaded.DATABASE_URL) throw new Error("Test environment must provide DATABASE_URL; shell/business fallback is forbidden.");
// File values cannot erase deployment flags checked above or provide enrollment.
for (const key of ["NODE_ENV", "VERCEL", "VERCEL_ENV", "NETLIFY", "RENDER_SERVICE_ID"]) {
	if (loaded[key] && (key !== "NODE_ENV" || loaded[key] !== "test")) throw new Error("Deployment configuration is forbidden in test env files.");
}
const approval = remoteApproval(loaded.DATABASE_URL);
// Consent/identity comes from independent enrollment (or the generated local file), never shell flags alone.
const target = assertDisposableDatabase({ ...process.env, ...loaded,
	DATABASE_URL: loaded.DATABASE_URL,
	NODE_ENV: "test",
	FLYNEXT_ALLOW_DATABASE_RESET: approval ? "1" : loaded.FLYNEXT_ALLOW_DATABASE_RESET,
	FLYNEXT_TEST_DATABASE_ID: approval?.id ?? loaded.FLYNEXT_TEST_DATABASE_ID,
}, "integration", approval);
Object.assign(process.env, loaded, { NODE_ENV: "test", FLYNEXT_ALLOW_DATABASE_RESET: "1", FLYNEXT_TEST_DATABASE_ID: approval?.id ?? loaded.FLYNEXT_TEST_DATABASE_ID });
process.env.RATE_LIMIT_DISABLED = "1";
// Integration tests never use real image credentials or a remote flight service.
for (const key of ["CLOUDINARY_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) process.env[key] = "";
process.env.AFS_MOCK = "true";
process.env.AFS_BASE_URL = "";
process.env.AFS_API_KEY = "";
export const IsTestDatabase = true;
export const TEST_DATABASE_NAME = target.name;
