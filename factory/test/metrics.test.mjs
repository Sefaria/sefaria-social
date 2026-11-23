// The metrics store (plan 5.9): append-only JSON lines on factory-data, written by CI. Tested against a local bare remote that
// stands in for GitHub, so the real push, branch creation and retry paths run. Tagged @guard metrics/<rule>.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git, makeRepo } from "./helpers.mjs";
import { buildLine, lineProblems, linesFromJobs, publishFile, pushLines, readMetrics } from "../metrics.mjs";

const ENV = {
  GITHUB_REPOSITORY: "Sefaria/sefaria-social",
  GITHUB_WORKFLOW: "ci",
  GITHUB_RUN_ID: "101",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_SHA: "a".repeat(40),
};
const NOW = new Date("2026-11-23T01:00:00Z");

/** A clone with a bare `origin`, like an Actions checkout. */
function cloneWithRemote() {
  const work = makeRepo();
  const bare = mkdtempSync(path.join(tmpdir(), "metrics-remote-"));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  return { work, bare };
}

const show = (bare, ref) => execFileSync("git", ["--git-dir", bare, "show", ref], { encoding: "utf8" });

describe("metrics", () => {
  it("builds a valid line from flags and the Actions environment", () => {
    const l = buildLine({ job: "static", result: "success", duration: "42", "tests-run": "121", extra: ["reason=x"] }, ENV, NOW);
    expect(lineProblems(l)).toEqual([]);
    expect(l).toMatchObject({
      v: 1,
      job: "static",
      result: "success",
      duration_s: 42,
      run_id: 101,
      tests: { run: 121 },
      extra: { reason: "x" },
    });
  });

  // @guard metrics/line-schema
  it("refuses a line without a job, with an unknown result, or with a negative duration", () => {
    expect(lineProblems(buildLine({ result: "won", duration: "-3" }, ENV, NOW))).toEqual([
      "job must be a non-empty string",
      "result 'won' is not one of success, failure, cancelled, skipped, neutral, timed_out, action_required, stale",
      "duration_s must be a non-negative number or null",
    ]);
  });

  it("turns a run's jobs into one line each, minus the excluded reporter", () => {
    const jobs = {
      jobs: [
        {
          name: "static",
          conclusion: "success",
          started_at: "2026-11-23T00:00:00Z",
          completed_at: "2026-11-23T00:01:10Z",
          head_sha: "b".repeat(40),
        },
        { name: "unit", conclusion: "skipped", started_at: null, completed_at: null, head_sha: "b".repeat(40) },
        { name: "metrics", conclusion: null, started_at: "2026-11-23T00:02:00Z", completed_at: null },
      ],
    };
    const lines = linesFromJobs(jobs, { exclude: ["metrics"] }, ENV, NOW);
    expect(lines.map((l) => [l.job, l.result, l.duration_s])).toEqual([
      ["static", "success", 70],
      ["unit", "skipped", null],
    ]);
    expect(lines.every((l) => lineProblems(l).length === 0)).toBe(true);
  });

  it("creates factory-data as an orphan branch on the first write, then appends", () => {
    const { work, bare } = cloneWithRemote();
    const first = pushLines(work, [buildLine({ job: "static", result: "success" }, ENV, NOW)], { attempts: 1 });
    expect(first).toMatchObject({ ok: true, created: true, files: ["metrics/2026-11.jsonl"] });
    const second = pushLines(work, [buildLine({ job: "unit", result: "failure" }, ENV, NOW)], { attempts: 1 });
    expect(second).toMatchObject({ ok: true, created: false });
    const text = show(bare, "factory-data:metrics/2026-11.jsonl");
    expect(
      text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).job),
    ).toEqual(["static", "unit"]);
    expect(show(bare, "factory-data:README.md")).toContain("Append-only data written by CI");
    // The orphan branch shares no history with main.
    expect(execFileSync("git", ["--git-dir", bare, "rev-list", "--count", "factory-data"], { encoding: "utf8" }).trim()).toBe(
      "2",
    );
  });

  it("appends after a line another writer pushed in between (it fetches the tip before every attempt)", () => {
    const { work, bare } = cloneWithRemote();
    pushLines(work, [buildLine({ job: "a", result: "success" }, ENV, NOW)], { attempts: 1 });
    // A second clone writes in between; the first clone has not seen it, and must append after it rather than overwrite.
    const other = mkdtempSync(path.join(tmpdir(), "metrics-other-"));
    execFileSync("git", ["clone", "-q", bare, other]);
    pushLines(other, [buildLine({ job: "b", result: "success" }, ENV, NOW)], { attempts: 1 });
    const r = pushLines(work, [buildLine({ job: "c", result: "success" }, ENV, NOW)], { attempts: 3 });
    expect(r.ok).toBe(true);
    expect(
      show(bare, "factory-data:metrics/2026-11.jsonl")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).job),
    ).toEqual(["a", "b", "c"]);
  });

  it("retries a refused push and lands the line on the next attempt", () => {
    const { work, bare } = cloneWithRemote();
    // The remote refuses the first push it receives (as when another job won the race), then accepts.
    const hook = path.join(bare, "hooks", "pre-receive");
    writeFileSync(
      hook,
      '#!/bin/sh\nif [ ! -f "$GIT_DIR/refused-once" ]; then touch "$GIT_DIR/refused-once"; echo "busy" >&2; exit 1; fi\n',
    );
    chmodSync(hook, 0o755);
    const r = pushLines(work, [buildLine({ job: "a", result: "success" }, ENV, NOW)], { attempts: 3 });
    expect(r).toMatchObject({ ok: true, attempt: 2 });
    expect(JSON.parse(show(bare, "factory-data:metrics/2026-11.jsonl")).job).toBe("a");
  });

  // @guard metrics/append-only
  it("never rewrites metrics: publishing a whole file under metrics/ is refused", () => {
    const { work } = cloneWithRemote();
    const f = path.join(mkdtempSync(path.join(tmpdir(), "m-")), "x.jsonl");
    writeFileSync(f, "{}\n");
    const r = publishFile(work, f, "metrics/2026-11.jsonl", { attempts: 1 });
    expect(r).toEqual({
      ok: false,
      error: "refused: metrics/2026-11.jsonl is under metrics/ (append-only; use 'record') or leaves the branch",
    });
    expect(publishFile(work, f, "retros/2026-W48.md", { attempts: 1 })).toMatchObject({
      ok: true,
      files: ["retros/2026-W48.md"],
    });
  });

  it("reads a metrics directory and reports invalid lines instead of dropping them silently", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "metrics-dir-"));
    writeFileSync(
      path.join(dir, "2026-11.jsonl"),
      `${JSON.stringify(buildLine({ job: "a", result: "success" }, ENV, NOW))}\nnot json\n{"v":1}\n`,
    );
    const { lines, problems } = readMetrics(dir);
    expect(lines.map((l) => l.job)).toEqual(["a"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^2026-11\.jsonl:2: not JSON/);
  });
});
