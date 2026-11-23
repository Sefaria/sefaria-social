// Builds the harness page (harness/dist). The surface itself is not bundled in: the page loads app/dist-surface through its
// manifest at run time, the way the reader does. Serve both with `npm run harness` (harness/serve.mjs).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
