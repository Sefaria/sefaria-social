// The QA recount (plan 5.5 L5a): what a pass means, counted by code, not by the runner. Tagged @guard qa/<rule>.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, cli } from "./helpers.mjs";
import { evidenceProblems, recount, renderComment, verdict, issueBodies } from "../qa.mjs";
import { fallbackEvidence } from "../../e2e/qa/env.mjs";

const pass = (line = 'heading "Sefaria Social"') => ({ outcome: "pass", evidence: [line] });
const fail = (note = "heading missing") => ({ outcome: "fail", evidence: [], note });
const J = (o) => ({ id: "J-001", surface: "feed", persona: "signed-out", title: "feed renders", attempts: [pass()], ...o });

describe("qa recount", () => {
  it("a journey whose only attempt passed with an evidence line is a pass", () => {
    expect(verdict(J())).toEqual({ verdict: "pass", why: 'heading "Sefaria Social"' });
  });

  // @guard qa/evidence
  it("a pass with no evidence line from the runner's session is a failure", () => {
    expect(verdict(J({ attempts: [{ outcome: "pass", evidence: ["  "] }] }))).toMatchObject({
      verdict: "fail",
      rule: "evidence",
    });
    expect(evidenceProblems({ journeys: [{ id: "J-9", attempts: [{ outcome: "maybe" }] }] })).toEqual([
      "journeys[0] (J-9) needs id, surface, persona and title",
      "journeys[0] (J-9).attempts[0].outcome must be 'pass' or 'fail'",
    ]);
  });

  // @guard qa/recovered-not-pass
  it("a retry after a failure is failed-then-recovered, never a pass", () => {
    const r = recount({ journeys: [J({ attempts: [fail(), pass()] })] });
    expect(r.journeys[0]).toMatchObject({ verdict: "failed-then-recovered", why: "failed on attempt 1, passed on attempt 2" });
    expect(r.counts.pass).toBe(0);
    expect(r.status).toBe("INCOMPLETE");
  });

  // @guard qa/cannot-reach-not-pass
  it("a surface that could not be reached is cannot-reach with its reason, even if an attempt says pass", () => {
    const r = recount({ journeys: [J({ cannot_reach: "harness: not-built (P1)", attempts: [pass()] })] });
    expect(r.journeys[0]).toMatchObject({ verdict: "cannot-reach", why: "harness: not-built (P1)" });
    expect(r.status).not.toBe("PASS");
  });

  // @guard qa/surface-without-journey
  it("blocks the report when a surface the diff touches has zero journeys", () => {
    const r = recount({ journeys: [J()] }, { surfaces: { feed: ["x"], session: ["y"] } });
    expect(r.status).toBe("BLOCKED");
    expect(r.blocked).toEqual([
      "surface 'session' changed in this PR but has zero journeys; the report is blocked until it is tested",
    ]);
  });

  // @guard qa/claim-mismatch
  it("reports when the runner's claimed counts differ from the recount, and fails", () => {
    const r = recount({ claimed: { pass: 2 }, journeys: [J(), J({ id: "J-002", attempts: [fail()] })] });
    expect(r.mismatches).toEqual(["runner claimed 2 pass, recount finds 1"]);
    expect(r.status).toBe("FAIL");
  });

  it("logs a journey on a surface the plan missed as a planner gap", () => {
    const r = recount({ planned_surfaces: ["feed"], journeys: [J(), J({ id: "J-002", surface: "session", planned: false })] });
    expect(r.gaps).toEqual(["J-002 on 'session' was not in the plan (planner gap)"]);
    expect(r.status).toBe("PASS");
  });

  it("renders one comment with the recount, and one issue body per failure with its transcript", () => {
    const r = recount({
      journeys: [J(), J({ id: "J-002", attempts: [fail("button absent")], transcript: "click Join; nothing" })],
    });
    const c = renderComment(r, { sha: "abcdef1234567", skeptic: "J-001: weak" });
    expect(c.split("\n")[0]).toBe("## Agent QA: FAIL (abcdef1234)");
    expect(c).toContain("| J-002 | feed | signed-out | fail | button absent |");
    expect(c).toContain("### Skeptic\n\nJ-001: weak");
    const issues = issueBodies(r, { pr: 7, sha: "abc" });
    expect(issues.map((i) => i.title)).toEqual(["QA fail: feed renders (feed, PR #7)"]);
    expect(issues[0].body).toContain("click Join; nothing");
  });

  it("CLI: writes the comment and issue files, exit 1 unless PASS", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-"));
    const ev = path.join(dir, "evidence.json");
    writeFileSync(ev, JSON.stringify({ sha: "s", journeys: [J({ attempts: [fail()] })] }));
    const r = cli(REPO, ["qa-recount", ev, "--comment", path.join(dir, "c.md"), "--issues", path.join(dir, "issues")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("qa-recount: FAIL (0 pass, 0 failed-then-recovered, 0 cannot-reach, 1 fail, 0 not-run)");
    expect(readFileSync(path.join(dir, "c.md"), "utf8")).toContain("## Agent QA: FAIL");
    expect(readdirSync(path.join(dir, "issues"))).toEqual(["J-001.md"]);
  });

  it("fallback evidence (the runner wrote none) marks every derived surface cannot-reach with the environment's reasons", () => {
    const ev = fallbackEvidence(
      { surfaces: { feed: [], session: [] } },
      { components: { harness: { status: "not-built", reason: "no 'qa:harness' script yet" } } },
    );
    const r = recount(ev, { surfaces: { feed: [], session: [] } });
    expect(r.journeys.map((j) => j.verdict)).toEqual(["cannot-reach", "cannot-reach"]);
    expect(r.journeys[0].why).toBe("the QA runner produced no evidence; environment: harness: no 'qa:harness' script yet");
  });
});
