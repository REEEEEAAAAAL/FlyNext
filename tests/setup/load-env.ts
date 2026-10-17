import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisposableDatabase } from "../../lib/database-safety";
import { loadEnvFile } from "./env-file";

// Check before a file could overwrite deployment flags.
if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NETLIFY || process.env.RENDER_SERVICE_ID) {
	throw new Error("Integration tests are forbidden in a production/deployment environment.");
}
const envPath = resolve(process.cwd(), ".env.test.local");
try { readFileSync(envPath, "utf8"); }
catch { throw new Error("Missing .env.test.local. Run npm run test:db:start; existing .env/.env.test are never used for integration tests."); }
const loaded = loadEnvFile(envPath);
// Consent/identity must be in this file, not inherited from an unrelated shell.
const target = assertDisposableDatabase({ ...process.env, ...loaded,
	DATABASE_URL: loaded.DATABASE_URL,
	FLYNEXT_ALLOW_DATABASE_RESET: loaded.FLYNEXT_ALLOW_DATABASE_RESET,
	FLYNEXT_TEST_DATABASE_ID: loaded.FLYNEXT_TEST_DATABASE_ID,
}, "integration");
process.env.RATE_LIMIT_DISABLED = "1";
// Integration tests never use real image credentials or a remote flight service.
for (const key of ["CLOUDINARY_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) process.env[key] = "";
process.env.AFS_MOCK = "true";
process.env.AFS_BASE_URL = "";
process.env.AFS_API_KEY = "";
export const IsTestDatabase = true;
export const TEST_DATABASE_NAME = target.name;
