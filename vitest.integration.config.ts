import { defineConfig } from "vitest/config";
import { aliases, unitTestFiles } from "./vitest.shared";
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		exclude: [...unitTestFiles, "node_modules/**"],
		globalSetup: ["tests/setup/global-setup.ts"],
		setupFiles: ["tests/setup/load-env.ts"],
		fileParallelism: false,
		pool: "forks",
		poolOptions: { forks: { singleFork: true } },
		testTimeout: 30_000, hookTimeout: 60_000,
		restoreMocks: true, clearMocks: true,
	},
	resolve: { alias: aliases },
});
