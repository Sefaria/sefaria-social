// Acceptance tests for spec 019 (surface bundle minified and held to a size budget). They drive the release CLI and read
// ci.yml, so they load on the merge base and fail there on an assertion. AC-001 (the real minified build) is
// app/src/surface/minify.contract.test.ts.
// @feature OPS-019 Surface bundle size budget checked in CI
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO } from "./helpers.mjs";
import { makeBuild, release, tempDir } from "./release-fixtures.mjs";

const budgetFile = (dir, limits) => {
  const file = path.join(dir, "budget.json");
  writeFileSync(
    file,
    JSON.stringify({ entryGzip: 10_000, largestChunkGzip: 10_000, totalGzip: 50_000, totalRaw: 100_000, files: 10, ...limits }),
  );
  return file;
};

describe("spec 019: surface size budget", () => {
  // @ac 019/AC-002
  it("passes a build within every budget and prints each file and the totals against their limits", () => {
    const dir = tempDir();
    makeBuild(path.join(dir, "build"), "1.0.0");
    const r = release(["budget", "--dir", path.join(dir, "build"), "--budget", budgetFile(dir, {})]);
    expect(r.out).toContain("surface:budget: PASS");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/assets\/surface\.e1\.js \(entry\)\s+[\d.]+ kB\s+[\d.]+ kB/);
    expect(r.stdout).toMatch(/assets\/chunk\.a\.js/);
    expect(r.stdout).toMatch(/assets\/social\.c1\.css/);
    expect(r.stdout).not.toMatch(/\.map/);
    for (const k of ["entryGzip", "largestChunkGzip", "totalGzip", "totalRaw", "files"])
      expect(r.stdout).toMatch(new RegExp(`${k}\\s+\\S+( kB)?\\s+\\S+( kB)?\\s+ok`));
  });

  // @ac 019/AC-003
  it("fails a build over a budget, and a build missing a listed file, naming the budget, size, limit and fix", () => {
    const dir = tempDir();
    // Random bytes do not compress: the entry's gzip size is about its raw size.
    const big = Buffer.from(Array.from({ length: 4000 }, () => Math.floor(Math.random() * 256))).toString("base64");
    makeBuild(path.join(dir, "build"), "1.0.0", { entry: `export default "${big}";\n` });
    const over = release(["budget", "--dir", path.join(dir, "build"), "--budget", budgetFile(dir, { entryGzip: 1000 })]);
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(/x entryGzip is [\d.]+ kB, over its budget of 1\.0 kB\. Fix: /);
    expect(over.stdout).toMatch(/entryGzip\s+[\d.]+ kB\s+1\.0 kB\s+OVER/);

    const gone = path.join(dir, "gone");
    makeBuild(gone, "1.0.0");
    rmSync(path.join(gone, "assets/chunk.a.js"));
    const missing = release(["budget", "--dir", gone, "--budget", budgetFile(dir, {})]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("assets/chunk.a.js is listed in the manifest but missing");
  });

  // @ac 019/AC-004
  it("ci.yml's build job runs the budget check right after the surface build", () => {
    const ci = YAML.parse(readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const steps = ci.jobs.build.steps.map((s) => String(s.run ?? ""));
    const surface = steps.findIndex((r) => /npm run build:surface/.test(r));
    expect(surface).toBeGreaterThanOrEqual(0);
    expect(steps[surface + 1]).toMatch(/npm run surface:budget/);
    // The committed budget file is well formed (the check refuses a malformed one).
    const budget = JSON.parse(readFileSync(path.join(REPO, "app/surface-budget.json"), "utf8"));
    for (const k of ["entryGzip", "largestChunkGzip", "totalGzip", "totalRaw", "files"]) expect(budget[k]).toBeGreaterThan(0);
  });
});
