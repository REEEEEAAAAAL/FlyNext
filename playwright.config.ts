import { defineConfig } from "@playwright/test";
import "./tests/setup/load-env";

if (process.env.FLYNEXT_E2E_VERIFIED !== "1") throw new Error("Use npm run test:e2e so database safety checks run first.");
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/verify-target.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/browser",
  use: { baseURL: "http://127.0.0.1:3210", browserName: "chromium", channel: "chrome", actionTimeout:15_000, navigationTimeout:30_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3210",
    url: "http://127.0.0.1:3210",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NODE_ENV: "production" },
  },
});
