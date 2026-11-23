// Acceptance tests for spec 084 (nightly: flake detection, collection check, quarantine, mutation, disabled L4b). CLI only, so
// they load on the merge base and fail there on an assertion.
// @feature OPS-087 Nightly flake detection over three runs
// @feature OPS-088 Collection check: test files on disk equal files executed
// @feature OPS-089 Quarantine list with reason, issue and expiry
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, makeRepo } from "./helpers.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "acc084-"));
const report = (root, statuses) => {
  const f = path.join(tmp(), "r.json");
  writeFileSync(
    f,
    JSON.stringify({
      numTotalTests: 2,
      testResults: [
        {
          name: path.join(root, "app/src/a.test.ts"),
          assertionResults: Object.entries(statuses).map(([title, status]) => ({ ancestorTitles: ["S"], title, status })),
        },
      ],
    }),
  );
  return f;
};
const QUARANTINED = (expires) =>
  `quarantine:\n  - test: "app/src/a.test.ts > S > wobbly"\n    reason: "times out about once in forty runs"\n    issue: https://github.com/Sefaria/sefaria-social/issues/1\n    added: ${expires.replace(/-\d\d$/, "-01")}\n    expires: ${expires}\n`;

describe("spec 084: nightly", () => {
  // @ac 084/AC-001
  it("flake detection lists a test whose result differs across three runs", () => {
    const root = makeRepo({ "factory/quarantine.yaml": "quarantine: []\n", "app/src/a.test.ts": "x" });
    const r = cli(root, [
      "flake",
      report(root, { steady: "passed", wobbly: "passed" }),
      report(root, { steady: "passed", wobbly: "failed" }),
      report(root, { steady: "passed", wobbly: "passed" }),
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("FLAKY: app/src/a.test.ts > S > wobbly (passed, failed, passed)");
    expect(r.stderr).toContain("flake: FAIL (1 test(s) with mixed results over 3 runs)");
  });

  // @ac 084/AC-002
  it("the collection check fails when a test file on disk was not executed, naming its level", () => {
    const root = makeRepo({ "app/src/a.test.ts": "x", "packages/session/src/b.test.ts": "x", "e2e/c.spec.ts": "x" });
    const r = cli(root, ["collection", report(root, { t: "passed" })]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x packages/session/src/b.test.ts (unit) is on disk but was not executed");
    expect(r.stderr).toContain("x e2e/c.spec.ts (e2e) is on disk but was not executed");
    expect(r.stdout).toContain("  unit: 2 on disk, 1 executed");
  });

  // @ac 084/AC-003
  it("an expired quarantine entry fails, and the repository's quarantine file is valid", () => {
    const r = cli(makeRepo({ "factory/quarantine.yaml": QUARANTINED("2026-01-20") }), ["quarantine"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("expired on 2026-01-20");
    expect(cli(REPO, ["quarantine"]).stdout).toContain("quarantine: PASS");
  });

  // @ac 084/AC-004
  it("a quarantined test's failure does not gate; an unquarantined failure does", () => {
    const root = makeRepo({ "factory/quarantine.yaml": QUARANTINED("2099-12-20").replace("2099-12-01", "2099-11-30") });
    const quarantined = cli(root, ["quarantine", "--report", report(root, { wobbly: "failed", steady: "passed" })]);
    expect(quarantined.stdout).toContain("notice: quarantined test failed (does not gate): app/src/a.test.ts > S > wobbly");
    expect(quarantined.code).toBe(0);
    expect(cli(root, ["quarantine", "--report", report(root, { steady: "failed" })]).code).toBe(1);
  });

  // @ac 084/AC-005
  it("nightly.yml runs every planned check; e2e-reader.yml is disabled with its reason; Stryker is configured for Vitest", () => {
    expect(["nightly.yml", "e2e-reader.yml"].filter((f) => !existsSync(path.join(REPO, ".github/workflows", f)))).toEqual([]);
    const nightly = YAML.parse(readFileSync(path.join(REPO, ".github/workflows/nightly.yml"), "utf8"));
    expect(Object.keys(nightly.jobs)).toEqual([
      "tests-3x",
      "mutation",
      "audit",
      "contract-drift",
      "docs-freshness",
      "doctor",
      "holdout-list",
      "holdout-trial",
      "holdout-score",
    ]);
    expect(Object.keys(nightly.on)).toEqual(["schedule", "workflow_dispatch"]);
    const reader = YAML.parse(readFileSync(path.join(REPO, ".github/workflows/e2e-reader.yml"), "utf8"));
    expect(reader.jobs.reader.if).toBe("vars.E2E_READER_ENABLED == 'true'");
    expect(reader.jobs.disabled.steps[0].run).toContain("L4b waits for the reader seam (A1)");
    expect(JSON.parse(readFileSync(path.join(REPO, "stryker.config.json"), "utf8"))).toMatchObject({
      testRunner: "vitest",
      plugins: ["@stryker-mutator/vitest-runner"],
    });
  });
});
