// Holdout scenarios (plan 5.5 L5b): format, three clean trials, pass/fail/unknown, and issues that never reveal scenario text.
// Tagged @guard holdout/<rule>. The scenarios here are invented fixtures, not real holdout scenarios.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli } from "./helpers.mjs";
import { issueBodies, leaks, redact, scenarioProblems, score } from "../holdout.mjs";

const S = {
  id: "H-901",
  title: "A fixture visitor finds the fixture page",
  story: "As a fixture visitor I open the fixture page and expect to see its fixture heading right away.",
  persona: "signed-out",
  start: "/social",
  rubric: [
    { id: "R1", dimension: "outcome", line: "The fixture heading is visible without scrolling." },
    { id: "R2", dimension: "navigation", line: "The address stays on the fixture page path." },
  ],
};
const trial = (n, g1 = "pass", g2 = "pass", clean = true) => ({
  scenario: "H-901",
  trial: n,
  clean,
  grades: [
    { rubric: "R1", grade: g1, note: "observed: heading" },
    { rubric: "R2", grade: g2, note: "observed: url" },
  ],
  observed: ["opened /social", "saw a heading"],
});

describe("holdout", () => {
  // @guard holdout/scenario-schema
  it("validates the scenario format", () => {
    expect(scenarioProblems(S)).toEqual([]);
    expect(
      scenarioProblems(
        {
          id: "X1",
          title: "t",
          story: "s",
          persona: "p",
          start: "social",
          rubric: [{ id: "R1", dimension: "vibes", line: "short" }],
        },
        "x.yaml",
      ),
    ).toEqual([
      "x.yaml: id must look like H-001",
      "x.yaml: 'start' is a path on the staging build, starting with /",
      "x.yaml: 'rubric' needs at least two lines",
      "x.yaml: rubric[0].dimension must be one of outcome, navigation, state, language, accessibility, resilience",
      "x.yaml: rubric[0].line must state an observable result",
    ]);
  });

  it("satisfaction is the share of clean trials in which every line passed; unknown is not a pass", () => {
    const r = score([S], [trial(1), trial(2, "pass", "unknown"), trial(3, "fail")]);
    expect(r.problems).toEqual([]);
    expect(r.scenarios).toEqual([{ scenario: "H-901", trials: 3, satisfied: 1, satisfaction: 1 / 3, unknown: 1 }]);
  });

  // @guard holdout/trials
  it("needs exactly three clean trials per scenario", () => {
    const r = score([S], [trial(1), trial(2), trial(3, "pass", "pass", false)]);
    expect(r.problems[0]).toMatch(/^H-901: 2 clean trial\(s\), need exactly 3/);
  });

  // @guard holdout/grades
  it("refuses a grade other than pass, fail or unknown, and a missing grade", () => {
    const bad = { ...trial(1), grades: [{ rubric: "R1", grade: "mostly" }] };
    expect(score([S], [bad, trial(2), trial(3)]).problems).toEqual([
      "H-901 trial 1: grade 'mostly' for R1 is not pass, fail or unknown",
      "H-901 trial 1: no grade for R2",
    ]);
  });

  // @guard holdout/leak
  it("an issue body never contains the story or a rubric line, even when a judge quoted them", () => {
    const quoting = {
      ...trial(1, "fail"),
      grades: [
        { rubric: "R1", grade: "fail", note: `expected: ${S.rubric[0].line}` },
        { rubric: "R2", grade: "pass" },
      ],
    };
    const [b] = issueBodies([S], [quoting, trial(2), trial(3)]);
    expect(b.body).not.toContain(S.rubric[0].line);
    expect(b.body).toContain("[redacted: scenario text]");
    expect(b.leaks).toEqual([]);
    expect(leaks(`x ${S.story} y`, S)).toEqual([S.story]);
    expect(redact(S.story, S)).toBe("[redacted: scenario text]");
  });

  it("CLI: validate prints no scenario text; issues writes redacted bodies", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "holdout-"));
    mkdirSync(path.join(dir, "scenarios"));
    mkdirSync(path.join(dir, "results"));
    writeFileSync(path.join(dir, "scenarios/h-901.yaml"), YAML.stringify(S));
    for (const t of [trial(1, "fail"), trial(2), trial(3)])
      writeFileSync(path.join(dir, `results/H-901-t${t.trial}.json`), JSON.stringify(t));
    const v = cli(REPO, ["holdout", "validate", path.join(dir, "scenarios")]);
    expect(v.code).toBe(0);
    expect(v.out).not.toContain("fixture heading");
    const s = cli(REPO, ["holdout", "score", path.join(dir, "scenarios"), path.join(dir, "results")]);
    expect(s.stdout).toContain("holdout: satisfaction 67%");
    expect(
      cli(REPO, ["holdout", "issues", path.join(dir, "scenarios"), path.join(dir, "results"), path.join(dir, "issues")]).code,
    ).toBe(0);
    expect(readdirSync(path.join(dir, "issues"))).toEqual(["H-901.md"]);
    expect(readFileSync(path.join(dir, "issues/H-901.md"), "utf8")).not.toContain(S.story);
  });
});
