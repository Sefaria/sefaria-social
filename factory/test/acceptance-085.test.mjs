// Acceptance tests for spec 085 (weekly retro). CLI only, so they load on the merge base and fail there on an assertion.
// @feature OPS-090 Weekly retro numbers from the metrics store
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli } from "./helpers.mjs";

const FIX = path.join(REPO, "factory/test/fixtures");
const run = (extra = []) => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "acc085-")), "retro.md");
  const r = cli(REPO, [
    "retro",
    "--metrics",
    path.join(FIX, "metrics"),
    "--retros",
    path.join(FIX, "retros"),
    "--week",
    "2026-W48",
    "--out",
    out,
    ...extra,
  ]);
  return { ...r, md: existsSync(out) ? readFileSync(out, "utf8") : "" };
};

describe("spec 085: retro", () => {
  // @ac 085/AC-001
  it("computes the week's numbers from the metrics: runs, failure rates, review, QA, flakes, cost", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.md).toContain("- CI job runs this week: 22 (+9 vs 2026-W47)");
    expect(r.md).toContain("| agent-qa / qa | 4 | 25% | 0 | 904 s |");
    expect(r.md).toContain("- Flaky tests found by the nightly: 1; quarantined now: 0");
  });

  // @ac 085/AC-002
  it("reports last weeks' action items as done, not done or dropped, and problems seen in more than one week", () => {
    const { md } = run();
    expect(md).toContain("- done (2026-W47): Add the Anthropic credential to the setup checklist (unassigned)");
    expect(md).toContain("- NOT DONE (2026-W47): Find why spec-gate failed on Wednesday (unassigned)");
    expect(md).toContain("- dropped (2026-W47): Try a second reviewer model");
    expect(md).toContain("- ci / spec-gate: failed in 2 weeks (2026-W47, 2026-W48)");
  });

  // @ac 085/AC-003
  it("lists invalid metrics lines and exits 1 rather than dropping them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "acc085-bad-"));
    writeFileSync(path.join(dir, "2026-11.jsonl"), "{broken\n");
    const r = cli(REPO, ["retro", "--metrics", dir, "--week", "2026-W48"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("- 2026-11.jsonl:1: not JSON");
  });

  // @ac 085/AC-004
  it("the committed docs/retros/2026-W48.md is the script's fixture run, marked as such", () => {
    const committed = path.join(REPO, "docs/retros/2026-W48.md");
    expect(existsSync(committed)).toBe(true);
    expect(readFileSync(committed, "utf8")).toBe(run(["--fixture"]).md);
    expect(readFileSync(committed, "utf8")).toContain("> **FIXTURE RUN.**");
  });

  // @ac 085/AC-005
  it("retro.yml computes the numbers without any secret, and gates the agent on its preflight", () => {
    const f = path.join(REPO, ".github/workflows/retro.yml");
    expect(existsSync(f)).toBe(true);
    const wf = YAML.parse(readFileSync(f, "utf8"));
    expect(JSON.stringify(wf.jobs.numbers)).not.toMatch(/secrets\./);
    expect(wf.jobs.agent.needs).toEqual(["numbers", "preflight"]);
    expect(wf.jobs.agent.if).toBe("needs.preflight.outputs.run == 'true'");
    expect(wf.jobs.preflight.steps.find((s) => s.id === "pre").run).toBe("node factory/preflight.mjs retro");
  });
});
