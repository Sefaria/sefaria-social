import { defineConfig, devices } from "@playwright/test";

// L4b (plan 5.5): the rooms journeys against the real reader. Disabled until the reader seam merges; see README.md here.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.READER_URL ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "reader-desktop", use: { ...devices["Desktop Chrome"] } }],
});
