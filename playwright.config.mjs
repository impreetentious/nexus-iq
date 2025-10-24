import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/a11y",
  testMatch: "**/*.a11y.js",
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:7341/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
