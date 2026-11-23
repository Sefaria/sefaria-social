// The surface build (plan 4.1; docs/decisions/0003-two-builds.md): a client-only ES module library that the reader loads into
// its page at runtime. Output in app/dist-surface/: assets/surface.<hash>.js (the entry; its default export is the Surface),
// lazy chunks, one CSS file, and manifest.json in the reader's manifest format with sha384 integrity hashes.
// `npm run build:surface` builds it; SURFACE_VERSION names the release (default "0.0.0-local").
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { SURFACE_HOST_CONTRACT } from "@sefaria-social/host-contract";
import { forbidServerImports, surfaceManifest } from "./surface-build";

const appSrc = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // A library build does not replace process.env.NODE_ENV by itself; React needs it to pick its production build.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    forbidServerImports(appSrc),
    viteReact(),
    surfaceManifest({ version: process.env.SURFACE_VERSION ?? "0.0.0-local", contract: SURFACE_HOST_CONTRACT.major }),
  ],
  build: {
    outDir: "dist-surface",
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false, // one CSS file for the whole surface
    sourcemap: true,
    target: "es2022",
    lib: { entry: "src/surface/entry.ts", formats: ["es"] },
    rolldownOptions: {
      output: {
        entryFileNames: "assets/surface.[hash].js",
        chunkFileNames: "assets/chunk.[hash].js",
        assetFileNames: "assets/social.[hash][extname]",
      },
    },
  },
});
