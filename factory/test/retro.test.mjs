// The weekly retro's computed half (plan 5.9), run on fixture metrics. Tagged @guard retro/<rule>.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, cli } from "./helpers.mjs";
import { actionItems, buildRetro, isoWeek, promotionCandidates } from "../retro.mjs";

const FIX = path.join(REPO, "factory/test/fixtures");
const build = (o = {}) =>
  buildRetro({ metricsDir: path.join(FIX, "metrics"), retrosDir: path.join(FIX, "retros"), root: REPO, week: "2026-W48", ...o });

describe("retro", () => {
  it("computes ISO weeks", () => {
    expect([
      isoWeek(new Date("2026-11-23T00:00:00Z")),
      isoWeek(new Date("2026-11-22T23:59:00Z")),
      isoWeek(new Date("2027-01-01T00:00:00Z")),
    ]).toEqual(["2026-W48", "2026-W47", "2026-W53"]);
  });

  it("computes the week's numbers, the change against last week, and recurring problems", () => {
    const r = build();
    expect(r.stats.runs).toBe(22);
    expect(r.md).toContain("- CI job runs this week: 22 (+9 vs 2026-W47)");
    expect(r.md).toContain("| ci / static | 4 | 25% | 0 | 29 s |");
    expect(r.md).toContain("- Agent QA: 8 pass, 1 failed-then-recovered, 4 cannot-reach; planner gaps: 1");
    expect(r.md).toContain("- ci / spec-gate: failed in 2 weeks (2026-W47, 2026-W48)");
  });

  // @guard retro/action-items
  it("reports every past action item as done, not done or dropped", () => {
    expect(
      actionItems("## Narrative\n- [ ] not an item\n## Action items\n- [x] a\n- [ ] b\n- [~] c\n## Other\n- [ ] d\n"),
    ).toEqual([
      { done: true, dropped: false, text: "a" },
      { done: false, dropped: false, text: "b" },
      { done: false, dropped: true, text: "c" },
    ]);
    expect(build().md).toContain("- NOT DONE (2026-W47): Find why spec-gate failed on Wednesday (unassigned)");
  });

  // @guard retro/metrics-valid
  it("lists invalid metrics lines in the retro and exits 1, instead of dropping them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "retro-"));
    writeFileSync(path.join(dir, "2026-11.jsonl"), '{"v":1,"job":"x"}\n');
    const r = cli(REPO, ["retro", "--metrics", dir, "--week", "2026-W48", "--out", path.join(dir, "r.md")]);
    expect(r.code).toBe(1);
    expect(readFileSync(path.join(dir, "r.md"), "utf8")).toContain("## Invalid metrics lines");
  });

  it("proposes QA promotion only after 20 consecutive runs with no false failure", () => {
    const runs = (n, falseAt = -1) =>
      Array.from({ length: n }, (_, i) => ({
        job: "qa",
        at: `2026-11-${String(1 + i).padStart(2, "0")}T00:00:00Z`,
        extra: { surface: "feed", false_failure: String(i === falseAt) },
      }));
    expect(promotionCandidates(runs(20))).toEqual([{ surface: "feed", streak: 20 }]);
    expect(promotionCandidates(runs(20, 5))).toEqual([]);
  });

  it("the committed fixture retro in docs/retros/ is exactly what the script produces (and says it is a fixture)", () => {
    const committed = readFileSync(path.join(REPO, "docs/retros/2026-W48.md"), "utf8");
    expect(committed).toBe(build({ fixture: true, root: null }).md);
    expect(committed).toContain("**FIXTURE RUN.**");
  });
});
