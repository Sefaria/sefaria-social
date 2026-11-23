// Nightly test-system health: collection check, flake detection, quarantine (plan 5.5). Tagged @guard test-health/<rule>.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cli, makeRepo, write } from "./helpers.mjs";
import { collectionCheck, flakeCheck, loadQuarantine, runQuarantine } from "../test-health.mjs";

const vitestReport = (root, files) => ({
  testResults: Object.entries(files).map(([f, tests]) => ({
    name: path.join(root, f),
    assertionResults: Object.entries(tests).map(([title, status]) => ({ ancestorTitles: ["S"], title, status })),
  })),
});
const out = () => {
  const lines = [];
  return { lines, log: (s) => lines.push(s), err: (s) => lines.push(s) };
};

describe("collection check", () => {
  // @guard test-health/collection
  it("fails when a test file on disk was not executed, per level, including one outside every level", () => {
    const root = makeRepo({
      "app/src/a.test.ts": "x",
      "test/architecture/b.test.ts": "x",
      "scripts/orphan.test.ts": "x",
      "factory/test/fixtures/ignored.test.mjs": "x",
    });
    const r = collectionCheck(root, [vitestReport(root, { "app/src/a.test.ts": { t: "passed" } })]);
    expect(r.ok).toBe(false);
    expect(r.byLevel.unit).toEqual({ onDisk: 1, executed: 1, missing: [] });
    expect(r.missing).toEqual(["scripts/orphan.test.ts", "test/architecture/b.test.ts"]);
    expect(r.byLevel.unclassified.missing).toEqual(["scripts/orphan.test.ts"]);
  });

  it("passes when every file on disk ran (Vitest and Playwright reports together)", () => {
    const root = makeRepo({ "app/src/a.test.ts": "x", "e2e/journey.spec.ts": "x" });
    const pw = {
      suites: [
        {
          file: "journey.spec.ts",
          specs: [{ title: "loads", tests: [{ projectName: "desktop", results: [{ status: "passed" }] }] }],
        },
      ],
    };
    expect(collectionCheck(root, [vitestReport(root, { "app/src/a.test.ts": { t: "passed" } }), pw]).ok).toBe(true);
  });
});

describe("flake detection", () => {
  // @guard test-health/flake
  it("lists tests with mixed results across runs, and separates quarantined ones", () => {
    const root = makeRepo();
    const run = (s1, s2) => vitestReport(root, { "app/src/a.test.ts": { steady: "passed", wobbly: s1, known: s2 } });
    const r = flakeCheck(
      root,
      [run("passed", "failed"), run("failed", "passed"), run("passed", "passed")],
      ["app/src/a.test.ts > S > known"],
    );
    expect(r.flaky.map((f) => [f.test, f.quarantined])).toEqual([
      ["app/src/a.test.ts > S > wobbly", false],
      ["app/src/a.test.ts > S > known", true],
    ]);
    expect(r.newFlaky).toHaveLength(1);
  });
});

describe("quarantine", () => {
  const entry = (o = {}) => ({
    test: "app/src/a.test.ts > S > wobbly",
    reason: "times out about once in forty runs",
    issue: "https://github.com/Sefaria/sefaria-social/issues/1",
    added: "2026-11-20",
    expires: "2026-12-10",
    ...o,
  });
  const repo = (entries) => makeRepo({ "factory/quarantine.yaml": `quarantine: ${JSON.stringify(entries)}\n` });

  it("accepts an empty list and a complete entry", () => {
    expect(loadQuarantine(repo([]), new Date("2026-11-23"))).toEqual({ entries: [], problems: [], expired: [] });
    expect(loadQuarantine(repo([entry()]), new Date("2026-11-23")).problems).toEqual([]);
  });

  // @guard test-health/quarantine-schema
  it("rejects an entry with no reason, no issue link, or an expiry more than 30 days out", () => {
    const q = loadQuarantine(repo([entry({ reason: "", issue: "see slack", expires: "2027-03-01" })]), new Date("2026-11-23"));
    expect(q.problems).toEqual([
      "entry 1 (app/src/a.test.ts > S > wobbly) needs a 'reason' that says what flakes",
      "entry 1 (app/src/a.test.ts > S > wobbly) needs an 'issue' link (https://github.com/<org>/<repo>/issues/<n>)",
      "entry 1 (app/src/a.test.ts > S > wobbly) expires more than 30 days after it was added",
    ]);
  });

  // @guard test-health/quarantine-expired
  it("fails on an expired entry, so a quarantine is never forgotten", () => {
    const o = out();
    expect(runQuarantine(repo([entry()]), [], o, new Date("2026-12-11"))).toBe(1);
    expect(o.lines.join("\n")).toContain("x entry 1 (app/src/a.test.ts > S > wobbly) expired on 2026-12-10");
  });

  // @guard test-health/quarantine-gate
  it("a quarantined test's failure is a notice; any other failure fails", () => {
    const root = repo([entry()]);
    const report = path.join(mkdtempSync(path.join(tmpdir(), "q-")), "r.json");
    writeFileSync(report, JSON.stringify(vitestReport(root, { "app/src/a.test.ts": { wobbly: "failed", steady: "passed" } })));
    const quiet = out();
    expect(runQuarantine(root, ["--report", report], quiet, new Date("2026-11-23"))).toBe(0);
    expect(quiet.lines[0]).toBe("  notice: quarantined test failed (does not gate): app/src/a.test.ts > S > wobbly");
    write(root, { "factory/quarantine.yaml": "quarantine: []\n" });
    const loud = out();
    expect(runQuarantine(root, ["--report", report], loud, new Date("2026-11-23"))).toBe(1);
    expect(loud.lines.join("\n")).toContain("x app/src/a.test.ts > S > wobbly failed and is not quarantined");
  });

  it("CLI: the repository's own quarantine file is valid", () => {
    const r = cli(path.resolve(import.meta.dirname, "../.."), ["quarantine"]);
    expect(r.stdout).toContain("quarantine: PASS");
  });
});
