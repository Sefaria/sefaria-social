// Acceptance tests for spec 086 (holdout scenarios: wiring, format, judge). CLI only, so they load on the merge base and fail
// there on an assertion. The scenario here is an invented fixture, not a real holdout scenario.
// @feature OPS-091 Holdout scenarios scored from three clean trials
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, humanEnv, makeRepo, write } from "./helpers.mjs";

const S = {
  id: "H-902",
  title: "A fixture learner opens the fixture lobby",
  story: "As a fixture learner I open a fixture lobby link and expect to see who is learning there right now.",
  persona: "learner",
  start: "/social/r/room-fixture-0001",
  rubric: [
    { id: "R1", dimension: "outcome", line: "The lobby lists the participants by display name." },
    { id: "R2", dimension: "state", line: "The fixture room's current ref is named on the lobby." },
  ],
};
const T = (n, g1, g2 = "pass", clean = true) => ({
  scenario: "H-902",
  trial: n,
  clean,
  grades: [
    { rubric: "R1", grade: g1, note: `judge saw: ${S.rubric[0].line}` },
    { rubric: "R2", grade: g2, note: "ok" },
  ],
  observed: ["opened the lobby"],
});
function dirs(trials) {
  const d = mkdtempSync(path.join(tmpdir(), "acc086-"));
  mkdirSync(path.join(d, "s"));
  mkdirSync(path.join(d, "r"));
  writeFileSync(path.join(d, "s/h-902.yaml"), YAML.stringify(S));
  for (const t of trials) writeFileSync(path.join(d, `r/H-902-t${t.trial}.json`), JSON.stringify(t));
  return d;
}

describe("spec 086: holdout scenarios", () => {
  // @ac 086/AC-001
  it("validates the scenario format without printing scenario text", () => {
    const d = dirs([]);
    const ok = cli(REPO, ["holdout", "validate", path.join(d, "s")]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("holdout: PASS (1 scenario(s) valid; text not printed)");
    writeFileSync(path.join(d, "s/bad.yaml"), YAML.stringify({ ...S, id: "H2", rubric: [] }));
    expect(cli(REPO, ["holdout", "validate", path.join(d, "s")]).stderr).toContain("x bad.yaml: id must look like H-001");
  });

  // @ac 086/AC-002
  it("scores satisfaction over exactly three clean trials, grading each rubric line pass, fail or unknown", () => {
    const mixed = dirs([T(1, "pass"), T(2, "unknown"), T(3, "fail")]);
    const good = cli(REPO, ["holdout", "score", path.join(mixed, "s"), path.join(mixed, "r")]);
    expect(good.code).toBe(0);
    expect(good.stdout).toContain("H-902: 1/3 trials satisfied (1 unknown grade(s))");
    const d = dirs([T(1, "pass"), T(2, "pass"), T(3, "pass", "pass", false)]);
    const short = cli(REPO, ["holdout", "score", path.join(d, "s"), path.join(d, "r")]);
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("H-902: 2 clean trial(s), need exactly 3");
  });

  // @ac 086/AC-003
  it("a failure's issue body describes the symptom and steps, never the story or a rubric line", () => {
    const d = dirs([T(1, "fail"), T(2, "pass"), T(3, "pass")]);
    expect(cli(REPO, ["holdout", "issues", path.join(d, "s"), path.join(d, "r"), path.join(d, "i")]).code).toBe(0);
    expect(readdirSync(path.join(d, "i"))).toEqual(["H-902.md"]);
    const body = readFileSync(path.join(d, "i/H-902.md"), "utf8");
    expect([body.includes(S.story), body.includes(S.rubric[0].line), body.includes("[redacted: scenario text]")]).toEqual([
      false,
      false,
      true,
    ]);
    expect(existsSync(path.join(REPO, ".github/ISSUE_TEMPLATE/holdout-failure.yml"))).toBe(true);
  });

  // @ac 086/AC-004
  it("the holdout lane skips with a notice until the deploy key, the repo name and a staging URL exist", () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "acc086-")), "o");
    const r = cli(
      REPO,
      ["preflight", "holdout"],
      humanEnv({ EVENT_NAME: "schedule", HAS_ANTHROPIC_API_KEY: "true", GITHUB_OUTPUT: out }),
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "holdout scenarios skipped: the secret HOLDOUT_DEPLOY_KEY, the variable HOLDOUT_REPO, the variable STAGING_URL are not configured",
    );
    expect(readFileSync(out, "utf8")).toContain("rule=holdout-inputs");
  });

  // @ac 086/AC-005
  it("only nightly.yml and release.yml may read the holdout deploy key", () => {
    const root = makeRepo();
    write(root, {
      ".github/workflows/agent-review.yml":
        "name: r\non: pull_request\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 1\n    steps:\n      - run: echo ${{ secrets.HOLDOUT_DEPLOY_KEY }}\n",
    });
    const r = cli(root, ["doctor", "--skip-tests"]);
    expect(r.stderr).toContain(
      "x [workflows] .github/workflows/agent-review.yml job 'a' reads HOLDOUT_DEPLOY_KEY; only .github/workflows/nightly.yml and .github/workflows/release.yml may check out the holdout repository",
    );
  });
});
