import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (L4a, plan section 5.5). Empty until milestone P1 adds the harness and its journeys; `npm run test:e2e`
// passes with no tests until then. Not run in CI yet.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["line"], ["json", { outputFile: "test-results/e2e.json" }]] : "line",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
