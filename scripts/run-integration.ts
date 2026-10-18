/** Reject deployment context before Vitest can normalize NODE_ENV in workers. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NETLIFY || process.env.RENDER_SERVICE_ID) {
	console.error("Integration tests refused in a production/deployment environment.");
	process.exitCode = 1;
} else {
	const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(2)], {
		stdio: "inherit", windowsHide: true, env: process.env,
	});
	if (result.error) console.error("Could not start the integration runner (details withheld).");
	process.exitCode = result.status ?? 1;
}
