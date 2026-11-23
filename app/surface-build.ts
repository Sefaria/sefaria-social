// Vite plugins for the surface build (vite.surface.config.ts):
//  - surfaceManifest: writes manifest.json in the format of the reader's pinned manifest schema
//    (packages/host-contract/pinned/surface-manifest.v1.ts): the entry, every chunk and stylesheet with a sha384 integrity hash,
//    paths relative to the manifest. The build fails if the manifest does not validate.
//  - forbidServerImports: the surface is client only (plan 4.1). Importing @tanstack/react-start, or anything under
//    app/src/server, fails the build (test/architecture checks the same rule over the source).
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { surfaceManifestSchema, type SurfaceManifest } from "@sefaria-social/host-contract";

export const MANIFEST_FILE = "manifest.json";

const sri = (source: string | Uint8Array) => `sha384-${createHash("sha384").update(source).digest("base64")}`;

export function surfaceManifest(opts: { version: string; contract: number }): Plugin {
  return {
    name: "social-surface-manifest",
    apply: "build",
    enforce: "post", // after Vite's CSS plugin has emitted the stylesheet
    generateBundle(_options, bundle) {
      let entry: { path: string; integrity: string } | null = null;
      const files: SurfaceManifest["files"] = [];
      const css: string[] = [];
      for (const [fileName, out] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (fileName.endsWith(".map") || fileName === MANIFEST_FILE) continue;
        const integrity = sri(out.type === "chunk" ? out.code : out.source);
        if (out.type === "chunk" && out.isEntry) {
          if (entry) this.error(`the surface build has two entry chunks (${entry.path}, ${fileName})`);
          entry = { path: fileName, integrity };
          continue;
        }
        if (out.type === "chunk" || fileName.endsWith(".css")) files.push({ path: fileName, integrity });
        if (fileName.endsWith(".css")) css.push(fileName);
      }
      if (!entry) return this.error("the surface build produced no entry chunk");
      const manifest = {
        version: opts.version,
        contract: opts.contract,
        entry: entry.path,
        integrity: entry.integrity,
        files,
        ...(css.length ? { css } : {}),
      };
      const checked = surfaceManifestSchema.safeParse(manifest);
      if (!checked.success)
        return this.error(`manifest.json does not match the reader's manifest schema: ${checked.error.message}`);
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: `${JSON.stringify(checked.data, null, 2)}\n` });
    },
  };
}

export function forbidServerImports(appSrc: string): Plugin {
  // Importers arrive as real paths (on macOS the temp dir is a symlink), so compare against the real path.
  const serverDir = path.join(realpathSync(appSrc), "server") + path.sep;
  const appSrcReal = realpathSync(appSrc);
  return {
    name: "social-surface-client-only",
    enforce: "pre",
    resolveId(source, importer) {
      if (/^@tanstack\/react-start(?:\/|$)/.test(source))
        this.error(
          `${importer ?? "?"} imports "${source}". The surface bundle is client only (plan 4.1). Fix: call the server through packages/api-client.`,
        );
      const abs = source.startsWith(".") && importer ? path.resolve(path.dirname(importer), source) : null;
      const aliased = source.startsWith("~/") ? path.join(appSrcReal, source.slice(2)) : null;
      const target = abs ?? aliased;
      if (target && (target + path.sep).startsWith(serverDir))
        this.error(
          `${importer ?? "?"} imports server code "${source}". The surface bundle never includes app/src/server (plan 4.1). Fix: reach the server over HTTPS through packages/api-client.`,
        );
      return null;
    },
  };
}
