import { defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Four projects. `architecture` (L0, the static job): structural rules over the source tree. `factory` (L0, the static job):
// the factory's own tests — every gate, hook and doctor rule with its negative test, in fixture git repos. `unit` (L1, the unit
// job): unit and component tests next to the code. `integration` (L2, the integration job): `*.int.test.ts`, the API against
// real Postgres with a test RSA key and a local JWKS server (test/integration/global-setup.ts), one file at a time because
// the files share one database. Every test has a time limit; a hung test fails instead of holding CI.
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./app/src", import.meta.url)) } },
  test: {
    testTimeout: 10_000,
    hookTimeout: 10_000,
    projects: [
      {
        extends: true,
        test: {
          name: "architecture",
          environment: "node",
          include: ["test/architecture/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "factory",
          environment: "node",
          include: ["factory/test/**/*.test.mjs"],
          // Fixture repos run git and child processes; prove-red runs vitest inside a worktree.
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        plugins: [viteReact()],
        test: {
          name: "unit",
          environment: "node",
          include: ["app/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        plugins: [viteReact()],
        test: {
          name: "integration",
          environment: "node",
          include: ["app/src/**/*.int.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
