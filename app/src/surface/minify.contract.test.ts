// L3 (spec 019): the surface build is fully minified. Vite's library mode keeps whitespace and /*#__PURE__*/ annotations
// in ES output unless asked otherwise; the reader downloads this bundle on every lab page, so it must not.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { surfaceManifestSchema } from "@sefaria-social/host-contract";
import { createHash } from "node:crypto";

const APP = fileURLToPath(new URL("../..", import.meta.url));
const sha384 = (file: string) => `sha384-${createHash("sha384").update(readFileSync(file)).digest("base64")}`;

describe("surface build, minified", () => {
  // @feature OPS-019 Surface bundle size budget checked in CI
  // @ac 019/AC-001
  it("emits minified JavaScript and CSS, and the manifest still hashes every file", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "surface-min-"));
    await build({
      configFile: path.join(APP, "vite.surface.config.ts"),
      configLoader: "runner",
      root: APP,
      logLevel: "silent",
      build: { outDir, sourcemap: false },
    });
    const manifest = surfaceManifestSchema.parse(JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8")));
    // Minified output is a handful of long lines (a few newlines survive inside template literals, such as React's stack
    // strings and zod's generated code); Vite's library output keeps about 30 lines per kB.
    let lines = 0;
    let bytes = 0;
    for (const p of [manifest.entry, ...manifest.files.map((f) => f.path)]) {
      const source = readFileSync(path.join(outDir, p), "utf8");
      lines += source.split("\n").length;
      bytes += Buffer.byteLength(source);
      expect(source, p).not.toContain("/*#__PURE__*/");
      expect(source, p).not.toContain("/* @__PURE__ */");
    }
    expect(lines, `${lines} lines in ${Math.round(bytes / 1000)} kB: the surface build is not minified`).toBeLessThan(
      bytes / 1000,
    );
    expect(manifest.integrity).toBe(sha384(path.join(outDir, manifest.entry)));
    for (const f of manifest.files) expect(f.integrity, f.path).toBe(sha384(path.join(outDir, f.path)));
  }, 60_000);
});
