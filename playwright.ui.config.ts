import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  outputDir: "test-results/ui",
  use: {
    baseURL: "http://127.0.0.1:3216",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3216",
    url: "http://127.0.0.1:3216",
    reuseExistingServer: false,
    env: { DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid" },
  },
});
