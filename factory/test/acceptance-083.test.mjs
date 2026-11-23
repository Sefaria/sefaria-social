// Acceptance tests for spec 083 (metrics store and quality score). CLI only, so they load on the merge base and fail there on an
// assertion. A local bare repository stands in for GitHub.
// @feature OPS-085 CI appends metrics lines to the factory-data branch
// @feature OPS-086 Quality score generated per surface
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, git, humanEnv, makeRepo, write } from "./helpers.mjs";

const ENV = humanEnv({
  GITHUB_REPOSITORY: "Sefaria/sefaria-social",
  GITHUB_WORKFLOW: "ci",
  GITHUB_RUN_ID: "77",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "c".repeat(40),
  GITHUB_EVENT_NAME: "pull_request",
});

function withRemote() {
  const work = makeRepo();
  const bare = mkdtempSync(path.join(tmpdir(), "acc083-remote-"));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  return { work, bare };
}
const lines = (bare) => {
  const month = new Date().toISOString().slice(0, 7);
  return execFileSync("git", ["--git-dir", bare, "show", `factory-data:metrics/${month}.jsonl`], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
};

describe("spec 083: metrics and quality score", () => {
  // @ac 083/AC-001
  it("record builds one validated line from the Actions environment", () => {
    const r = cli(
      REPO,
      ["metrics", "record", "--job", "static", "--result", "success", "--duration", "31", "--tests-run", "121", "--dry-run"],
      ENV,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      v: 1,
      repo: "Sefaria/sefaria-social",
      workflow: "ci",
      run_id: 77,
      sha: "c".repeat(40),
      job: "static",
      result: "success",
      duration_s: 31,
      tests: { run: 121 },
    });
  });

  // @ac 083/AC-002
  it("the first write creates factory-data (an orphan branch); later writes append", () => {
    const { work, bare } = withRemote();
    const first = cli(work, ["metrics", "record", "--job", "static", "--result", "success"], ENV);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("branch created");
    cli(work, ["metrics", "record", "--job", "unit", "--result", "failure"], ENV);
    expect(lines(bare).map((l) => [l.job, l.result])).toEqual([
      ["static", "success"],
      ["unit", "failure"],
    ]);
    // An orphan branch: its history is its own two commits, nothing from main.
    expect(execFileSync("git", ["--git-dir", bare, "rev-list", "--count", "factory-data"], { encoding: "utf8" }).trim()).toBe(
      "2",
    );
  });

  // @ac 083/AC-003
  it("refuses an invalid line, and never rewrites metrics/ (append-only)", () => {
    const bad = cli(REPO, ["metrics", "record", "--result", "won", "--dry-run"], ENV);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("x line 1 (?): job must be a non-empty string");
    const { work } = withRemote();
    const f = path.join(mkdtempSync(path.join(tmpdir(), "acc083-")), "f.jsonl");
    writeFileSync(f, "{}\n");
    const rewrite = cli(work, ["metrics", "publish", "--file", f, "--to", "metrics/2026-11.jsonl"], ENV);
    expect(rewrite.code).toBe(1);
    expect(rewrite.stderr).toContain("refused: metrics/2026-11.jsonl is under metrics/ (append-only");
  });

  // @ac 083/AC-004
  it("from-run writes one line per job of the run, minus the reporter itself", () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "acc083-")), "jobs.json");
    writeFileSync(
      f,
      JSON.stringify({
        jobs: [
          { name: "static", conclusion: "success", started_at: "2026-11-23T00:00:00Z", completed_at: "2026-11-23T00:00:30Z" },
          { name: "result", conclusion: "failure" },
          { name: "metrics", conclusion: null },
        ],
      }),
    );
    const r = cli(REPO, ["metrics", "from-run", "--jobs-file", f, "--exclude", "metrics", "--dry-run"], ENV);
    expect(r.code).toBe(0);
    expect(
      r.stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .map((l) => [l.job, l.result, l.duration_s]),
    ).toEqual([
      ["static", "success", 30],
      ["result", "failure", null],
    ]);
  });

  // @ac 083/AC-005
  it("ci.yml's metrics job runs after result, skips forks on purpose, and never fails the run; the composite action is soft too", () => {
    const action = path.join(REPO, ".github/actions/metrics/action.yml");
    expect(existsSync(action)).toBe(true);
    const job = YAML.parse(readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8")).jobs.metrics;
    expect(job.needs).toContain("result");
    expect(job.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(job.permissions).toEqual({ contents: "write", actions: "read" });
    expect(job.steps.at(-1).run).toBe("node factory/metrics.mjs from-run --exclude metrics --soft");
    expect(readFileSync(action, "utf8")).toContain('args=(record --job "$M_JOB" --result "$M_RESULT" --soft)');
  });

  // @ac 083/AC-006
  it("quality-score writes the per-surface table, and --check fails once it is stale", () => {
    const root = makeRepo({
      "factory/surface-map.yaml":
        "surfaces:\n  feed:\n    description: f\n    reach: harness\n    paths: ['app/src/features/feed/**']\n",
      "factory/quarantine.yaml": "quarantine: []\n",
      "app/src/features/feed/Feed.test.tsx": "x",
    });
    expect(cli(root, ["quality-score"]).code).toBe(0);
    expect(readFileSync(path.join(root, "docs/QUALITY_SCORE.md"), "utf8")).toContain(
      "| feed | 0 | 0 | 1 | 0 | 0 | 0 | 0 | n/a | n/a |",
    );
    write(root, { "app/src/features/feed/More.test.tsx": "x" });
    const r = cli(root, ["quality-score", "--check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("fix: run 'npm run factory -- quality-score' and commit docs/QUALITY_SCORE.md.");
  });
});
