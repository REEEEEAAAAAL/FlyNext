import { defineConfig } from "vitest/config";
import { aliases, unitTestFiles } from "./vitest.shared";

/** Safe default: no env-file loading, database connections, migrations or reset. */
export default defineConfig({
	test: {
		environment: "node",
		include: unitTestFiles,
		globalSetup: [],
		setupFiles: [],
		restoreMocks: true,
		clearMocks: true,
	},
	resolve: { alias: aliases },
});
