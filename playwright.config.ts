import { defineConfig, devices } from "@playwright/test";

// End-to-end tests on the harness (L4a, plan 5.5): the built surface loaded into the fake reader page, on a desktop and a phone
// viewport; each journey runs in English and Hebrew. `npm run test:e2e` builds the surface and the harness first; the web
// server below only serves them (harness/serve.mjs). The real-reader lane (L4b) is a later milestone.
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
  webServer: {
    command: "node harness/serve.mjs",
    url: `http://localhost:${PORT}/social`,
    env: { HARNESS_PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
