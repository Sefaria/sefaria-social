// L3: the surface build's output is what the reader loads (docs/decisions/0003-two-builds.md and the reader's manifest
// schema, pinned in packages/host-contract/pinned/surface-manifest.v1.ts). Runs the real build into a temporary folder.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { surfaceManifestSchema } from "@sefaria-social/host-contract";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const plugins = import.meta.glob<typeof import("../../surface-build")>("../../surface-build.ts");
async function loadPlugins() {
  const mod = await plugins["../../surface-build.ts"]?.();
  expect(mod, "app/surface-build.ts (the surface build's manifest and client-only plugins) exists").toBeDefined();
  return mod!;
}

const sha384 = (file: string) => `sha384-${createHash("sha384").update(readFileSync(file)).digest("base64")}`;

describe("surface build", () => {
  // @feature HOST-004 Surface build with a release manifest
  // @ac 002/AC-001
  it("emits an ES module entry, its chunks, one CSS file and a manifest the reader's schema accepts, every file hashed", async () => {
    await loadPlugins();
    const outDir = mkdtempSync(path.join(tmpdir(), "surface-build-"));
    await build({
      configFile: path.join(APP, "vite.surface.config.ts"),
      configLoader: "runner",
      root: APP,
      logLevel: "silent",
      build: { outDir, sourcemap: false },
    });
    const manifest = surfaceManifestSchema.parse(JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8")));
    expect(manifest.contract).toBe(1);
    expect(manifest.entry).toMatch(/^assets\/surface\.[\w-]+\.js$/);
    expect(manifest.integrity).toBe(sha384(path.join(outDir, manifest.entry)));
    const emitted = readdirSync(path.join(outDir, "assets")).map((f) => `assets/${f}`);
    const js = emitted.filter((f) => f.endsWith(".js") && f !== manifest.entry).sort();
    const css = emitted.filter((f) => f.endsWith(".css"));
    expect(js.length).toBeGreaterThan(0);
    expect(css).toHaveLength(1);
    expect(manifest.css).toEqual(css);
    expect(manifest.files.map((f) => f.path).sort()).toEqual([...js, ...css].sort());
    for (const f of manifest.files) expect(f.integrity, f.path).toBe(sha384(path.join(outDir, f.path)));
    const entrySource = readFileSync(path.join(outDir, manifest.entry), "utf8");
    expect(entrySource).toMatch(/export\s*\{[^}]*\bas default\b/);
  }, 60_000);

  // @feature HOST-004 Surface build with a release manifest
  // @ac 002/AC-001
  it("fails the build when surface code imports the Start runtime or app/src/server", async () => {
    const { forbidServerImports } = await loadPlugins();
    const dir = mkdtempSync(path.join(tmpdir(), "surface-ban-"));
    const cases = {
      start: 'import { createServerFn } from "@tanstack/react-start";\nexport default createServerFn;\n',
      server: 'import x from "./server/db";\nexport default x;\n',
    };
    for (const [name, code] of Object.entries(cases)) {
      writeFileSync(path.join(dir, `${name}.ts`), code);
      const run = build({
        configFile: false,
        root: dir,
        logLevel: "silent",
        plugins: [forbidServerImports(dir)],
        build: { outDir: path.join(dir, `out-${name}`), lib: { entry: path.join(dir, `${name}.ts`), formats: ["es"] } },
      });
      await expect(run, name).rejects.toThrow(name === "start" ? /client only/ : /never includes app\/src\/server/);
    }
  }, 60_000);
});
