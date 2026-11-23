import { defineConfig, devices } from "@playwright/test";

// End-to-end tests on the harness (L4a, plan 5.5): the built surface loaded into the fake reader page, on a desktop and a phone
// viewport; each journey runs in English and Hebrew. `npm run test:e2e` builds the surface, the harness and the Start server
// first; the web servers below serve the harness (harness/serve.mjs) and the local stack for the rooms journeys
// (e2e/stack/start.ts: Postgres, a JWKS, the API, the relay under wrangler dev). The real-reader lane (L4b) is in e2e/reader/,
// disabled here until the reader seam merges (see e2e/reader/README.md).
const PORT = Number(process.env.HARNESS_PORT) || 3300;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["line"], ["json", { outputFile: "test-results/e2e.json" }]] : "line",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  testIgnore: ["reader/**"],
  webServer: [
    {
      command: "node harness/serve.mjs",
      url: `http://localhost:${PORT}/social`,
      env: { HARNESS_PORT: String(PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npx tsx e2e/stack/start.ts",
      url: "http://127.0.0.1:3200/api/v1/health",
      env: { HARNESS_PORT: String(PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Several browser contexts and shared server state: the rooms and feed journeys and the feed's visual baselines run once,
    // on desktop.
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testIgnore: ["reader/**", "rooms.spec.ts", "feed.spec.ts", "feed-visual.spec.ts"],
    },
  ],
});
