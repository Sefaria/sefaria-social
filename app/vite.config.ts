import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// The Start build (plan section 4.1): the Node server for the social API, webhooks, health and the standalone pages.
// The surface bundle that runs inside the reader page is a separate build: vite.surface.config.ts.
export default defineConfig({
  // PORT (set by a preview tool) wins; otherwise 3200 (3100 is the reader, 3000 is taken).
  server: { port: Number(process.env.PORT) || 3200, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart(), // must come before react()
    viteReact(),
  ],
});
