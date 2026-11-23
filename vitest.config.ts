import { defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Two projects. `architecture` (L0, the static job): structural rules over the source tree. `unit` (L1, the unit job): unit and
// component tests next to the code. Every test has a time limit; a hung test fails instead of holding CI.
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
        plugins: [viteReact()],
        test: {
          name: "unit",
          environment: "node",
          include: ["app/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
