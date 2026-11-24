// Acceptance tests for spec 040 (calls: the call chunk's own budget, and the e2e lane). They drive the release CLI on fake
// builds and read the committed config, so they load on the merge base and fail there on an assertion.
// @feature OPS-094 Call chunk budget
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO } from "./helpers.mjs";

// ── Release fixtures (the same block in acceptance-019/020/021: prove-red copies only test files onto the merge base, so a
// shared helper module would not load there). A fake surface build and runners for the release CLI and scripts/rollback,
// driven as child processes only. ──────────────────────────────────────────────────────────────────────────────────────────
const made = [];
afterEach(() => {
  while (made.length) rmSync(made.pop(), { recursive: true, force: true });
});

function tempDir(prefix = "release-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

const sri = (body) => `sha384-${createHash("sha384").update(body).digest("base64")}`;

/**
 * A surface build in `dir`: an entry, `chunks` (name → source), one stylesheet, a source map that the manifest does not list,
 * and manifest.json. Returns the manifest.
 */
function makeBuild(
  dir,
  version,
  { entry = "export default { id: 'social' };\n", chunks = { a: "export const a = 1;\n" }, call = null } = {},
) {
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  const files = [];
  const put = (rel, body) => {
    writeFileSync(path.join(dir, rel), body);
    return { path: rel, integrity: sri(Buffer.from(body)) };
  };
  const e = put("assets/surface.e1.js", entry);
  for (const [name, body] of Object.entries(chunks)) files.push(put(`assets/chunk.${name}.js`, body));
  if (call !== null) files.push(put("assets/call.k1.js", call));
  files.push(put("assets/social.c1.css", ".social{color:red}\n"));
  writeFileSync(path.join(dir, "assets/surface.e1.js.map"), '{"version":3}');
  const manifest = { version, contract: 1, entry: e.path, integrity: e.integrity, files, css: ["assets/social.c1.css"] };
  writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const RELEASE_CLI = path.join(REPO, "app", "scripts", "release", "cli.ts");

/** `npm run release -- <args>`, with RELEASE_TARGET set to `target` (or unset when null). */
function release(args, { target, cwd = REPO } = {}) {
  const env = { ...process.env };
  delete env.RELEASE_TARGET;
  if (target) env.RELEASE_TARGET = target;
  const r = spawnSync(TSX, [RELEASE_CLI, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const budgetFile = (dir, limits) => {
  const file = path.join(dir, `budget-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(
    file,
    JSON.stringify({ entryGzip: 10_000, largestChunkGzip: 10_000, totalGzip: 50_000, totalRaw: 100_000, files: 10, ...limits }),
  );
  return file;
};

/** Random bytes do not compress: gzip size is about the raw size. */
const noise = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256))).toString("base64");
const run = (dir, limits) => release(["budget", "--dir", dir, "--budget", budgetFile(path.dirname(dir), limits)]);

describe("spec 040: the call chunk's own budget", () => {
  // @ac 040/AC-001
  it("measures the call chunk against its own limit and leaves it out of the other totals", () => {
    const dir = tempDir();
    const build = path.join(dir, "build");
    makeBuild(build, "1.0.0", { call: `export default "${noise(6000)}";\n` });
    // Without the call chunk, the build is far within every other limit; the call chunk alone would break three of them.
    const ok = run(build, { largestChunkGzip: 1_000, totalGzip: 2_000, totalRaw: 4_000, files: 3, callChunkGzip: 20_000 });
    expect(ok.out).toContain("surface:budget: PASS");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/assets\/call\.k1\.js \(call\)/);
    expect(ok.stdout).toMatch(/callChunkGzip\s+[\d.]+ kB\s+20\.0 kB\s+ok/);
    expect(ok.stdout).toMatch(/files\s+3\s+3\s+ok/);

    const over = run(build, { callChunkGzip: 1_000 });
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(/x callChunkGzip is [\d.]+ kB, over its budget of 1\.0 kB\. Fix: /);
  });

  // @ac 040/AC-001
  it("refuses a build that has a call chunk when the budget sets no limit for it", () => {
    const dir = tempDir();
    const build = path.join(dir, "build");
    makeBuild(build, "1.0.0", { call: "export const call = 1;\n" });
    const r = run(build, {});
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/assets\/call\.k1\.js is a call chunk but .* has no "callChunkGzip"\. Fix: /);
  });

  // @ac 040/AC-001
  it("allows the entry to grow at most 4 kB over its size before calls", () => {
    const dir = tempDir();
    const build = path.join(dir, "build");
    makeBuild(build, "1.0.0", { entry: `export default "${noise(8000)}";\n`, call: "export const call = 1;\n" });
    const within = run(build, { entryGzipBeforeCalls: 5_000, callChunkGzip: 10_000 });
    expect(within.code, within.out).toBe(0);
    expect(within.stdout).toMatch(/entryGrowthSinceCalls\s+[\d.]+ kB\s+4\.0 kB\s+ok/);
    const over = run(build, { entryGzipBeforeCalls: 1_000, callChunkGzip: 10_000 });
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(/x entryGrowthSinceCalls is [\d.]+ kB, over its budget of 4\.0 kB\. Fix: /);
  });

  // @ac 040/AC-001
  it("the committed budget sets the call chunk's limit and the entry before calls, and the build names the call chunk", () => {
    const budget = JSON.parse(readFileSync(path.join(REPO, "app/surface-budget.json"), "utf8"));
    expect(budget.callChunkGzip).toBeGreaterThan(0);
    expect(budget.entryGzipBeforeCalls).toBe(77_055);
    const config = readFileSync(path.join(REPO, "app/vite.surface.config.ts"), "utf8");
    expect(config).toContain("assets/call.[hash].js");
  });
});
