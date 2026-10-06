/**
 * Vitest configuration for the FlyNext API integration suite.
 *
 * The suites import App Router handlers directly and call them with a real
 * `NextRequest`, so the runtime has to be Node — the handlers talk to PostgreSQL
 * through Prisma — and the `@/` path alias from `tsconfig.json` has to resolve.
 * No React plugin is needed: nothing under `app/api/` renders, and the pages are
 * covered by the type checker and the production build instead.
 *
 * Every suite talks to a real database. The connection string comes from
 * `.env.test`, which `tests/setup/global-setup.ts` loads and validates before any
 * suite runs.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "tests/*.test.ts"],
		globalSetup: ["tests/setup/global-setup.ts"],
		setupFiles: ["tests/setup/load-env.ts"],
		// One database is shared by all suites and each case truncates the tables it
		// uses, so suites run one at a time in a single process.
		fileParallelism: false,
		pool: "forks",
		poolOptions: {
			forks: { singleFork: true },
		},
		// The oversell suite fires two bookings simultaneously on purpose and the
		// database is remote, so the default 5 s is not enough.
		testTimeout: 30_000,
		hookTimeout: 60_000,
		restoreMocks: true,
		clearMocks: true,
	},
	resolve: {
		alias: [
			{
				// The `@/` prefix from `tsconfig.json`, expressed as a pattern so
				// that relative imports are still resolved by Vite itself.
				find: /^@\//,
				replacement: `${projectRoot}/`,
			},
			{
				// Test-only modules, addressed the same way from every suite. The
				// `#` prefix cannot collide with a package name or a source file.
				find: /^#support\//,
				replacement: `${projectRoot}/tests/support/`,
			},
			{
				find: /^#setup\//,
				replacement: `${projectRoot}/tests/setup/`,
			},
		],
	},
});
