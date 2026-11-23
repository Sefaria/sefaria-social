#!/usr/bin/env node
// The metrics store (plan 5.8, 5.9): append-only JSON lines on the branch `factory-data`, under `metrics/YYYY-MM.jsonl`.
// Every CI job appends one line: run id, commit, model id, job, result, duration, tests run/skipped/quarantined, tokens.
// Workflows push with the default GITHUB_TOKEN, and a push made with that token does not trigger CI, so the data branch
// needs no CI. The branch is created by the first workflow run that writes (an orphan commit), never by hand.
// Zero dependencies (only node builtins), so a workflow can run it before `npm ci`.
//
//   node factory/metrics.mjs record --job <name> --result <conclusion> [--duration <s>] [--model <id>]
//        [--tests-run N --tests-skipped N --tests-quarantined N] [--tokens-in N --tokens-out N] [--cost USD]
//        [--extra key=value ...] [--local <file> | --branch factory-data --remote origin] [--dry-run] [--soft]
//   node factory/metrics.mjs publish --file <local> --to <path on the branch> [--soft]   retros and reports (not metrics/)
//   node factory/metrics.mjs from-run [--jobs-file <jobs.json>] [--exclude <job> ...] [same output flags]
//        one line per job of the current workflow run (GitHub's jobs API), for ci.yml's `metrics` job.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Rule ids; each has a negative test tagged `@guard metrics/<id>` (doctor checks). */
export const RULES = ["line-schema", "append-only"];

export const BRANCH = "factory-data";
export const DIR = "metrics";
export const RESULTS = ["success", "failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "stale"];
const BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];
const BRANCH_README = `# factory-data

Append-only data written by CI (docs/PLAN.md 5.9). Never edit by hand; never merge into main.

- \`metrics/YYYY-MM.jsonl\`: one JSON line per CI job run (schema: factory/metrics.mjs in the main branch).
- \`retros/\`: the weekly retro's numbers and notes (retro.yml).
- \`reports/\`: nightly reports (quality score with flake counts, collection check, mutation score).

Pushes here use the default workflow token, which does not trigger CI.
`;

const isCount = (v) => v === null || (Number.isInteger(v) && v >= 0);
const isNum = (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** Problems with one metrics line (an object). Empty when valid. */
export function lineProblems(line) {
  const p = [];
  if (!line || typeof line !== "object" || Array.isArray(line)) return ["a metrics line must be a JSON object"];
  if (line.v !== 1) p.push("v must be 1");
  for (const k of ["at", "repo", "workflow", "job", "result", "sha"])
    if (typeof line[k] !== "string" || !line[k]) p.push(`${k} must be a non-empty string`);
  if (line.at && Number.isNaN(Date.parse(line.at))) p.push("at must be an ISO date");
  if (line.result && !RESULTS.includes(line.result)) p.push(`result '${line.result}' is not one of ${RESULTS.join(", ")}`);
  if (!isCount(line.run_id ?? null) || !isCount(line.run_attempt ?? null)) p.push("run_id and run_attempt are integers or null");
  if (!isNum(line.duration_s ?? null)) p.push("duration_s must be a non-negative number or null");
  for (const k of ["run", "skipped", "quarantined"])
    if (!isCount(line.tests?.[k] ?? null)) p.push(`tests.${k} must be a non-negative integer or null`);
  for (const k of ["input", "output"])
    if (!isCount(line.tokens?.[k] ?? null)) p.push(`tokens.${k} must be a non-negative integer or null`);
  if (!isNum(line.cost_usd ?? null)) p.push("cost_usd must be a non-negative number or null");
  if (line.extra !== undefined && (typeof line.extra !== "object" || line.extra === null || Array.isArray(line.extra)))
    p.push("extra must be an object");
  return p;
}

const int = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

/** Build a line from flags and the GitHub Actions environment. */
export function buildLine(flags, env = process.env, now = new Date()) {
  const extra = {};
  for (const kv of [].concat(flags.extra ?? [])) {
    const i = kv.indexOf("=");
    if (i > 0) extra[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return {
    v: 1,
    at: now.toISOString(),
    repo: env.GITHUB_REPOSITORY || "local",
    workflow: flags.workflow || env.GITHUB_WORKFLOW || "local",
    run_id: int(flags["run-id"] ?? env.GITHUB_RUN_ID),
    run_attempt: int(env.GITHUB_RUN_ATTEMPT),
    event: env.GITHUB_EVENT_NAME || "local",
    ref: env.GITHUB_HEAD_REF || env.GITHUB_REF || null,
    sha: flags.sha || env.GITHUB_SHA || "unknown",
    pr: int(flags.pr ?? env.PR_NUMBER),
    job: flags.job,
    result: flags.result,
    duration_s: int(flags.duration),
    model: flags.model || null,
    tests: { run: int(flags["tests-run"]), skipped: int(flags["tests-skipped"]), quarantined: int(flags["tests-quarantined"]) },
    tokens: { input: int(flags["tokens-in"]), output: int(flags["tokens-out"]) },
    cost_usd: flags.cost === undefined ? null : Number(flags.cost),
    extra,
  };
}

/** Lines for the jobs of one workflow run (the shape of GET /repos/{o}/{r}/actions/runs/{id}/attempts/{n}/jobs). */
export function linesFromJobs(jobsJson, flags, env = process.env, now = new Date()) {
  const exclude = new Set([].concat(flags.exclude ?? []));
  return (jobsJson.jobs ?? [])
    .filter((j) => !exclude.has(j.name))
    .map((j) => {
      const start = Date.parse(j.started_at ?? "");
      const end = Date.parse(j.completed_at ?? "");
      const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 1000) : null;
      return buildLine(
        { ...flags, job: j.name, result: j.conclusion || "cancelled", duration, sha: j.head_sha || flags.sha },
        env,
        now,
      );
    });
}

/** Month file for a line, e.g. metrics/2026-11.jsonl. */
export const monthFile = (dir, at) => `${dir}/${String(at).slice(0, 7)}.jsonl`;

/** Parse every metrics file under a directory. Returns { lines, problems }. Invalid lines are reported, never dropped silently. */
export function readMetrics(dir) {
  const lines = [];
  const problems = [];
  if (!existsSync(dir)) return { lines, problems };
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()) {
    readFileSync(path.join(dir, f), "utf8")
      .split("\n")
      .forEach((raw, i) => {
        if (!raw.trim()) return;
        try {
          const l = JSON.parse(raw);
          const p = lineProblems(l);
          if (p.length) problems.push(`${f}:${i + 1}: ${p.join("; ")}`);
          else lines.push(l);
        } catch (e) {
          problems.push(`${f}:${i + 1}: not JSON (${e.message})`);
        }
      });
  }
  return { lines, problems };
}

const g = (cwd, args, opts = {}) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Commit a change to the data branch and push it, retrying when another job pushed first (fetch the new tip, redo the change,
 * push). Works in a temporary worktree of `root`, so it reuses the checkout's credentials. `change(worktreeDir)` edits files.
 */
export function commitToDataBranch(
  root,
  change,
  { branch = BRANCH, remote = "origin", attempts = 6, message = "factory-data" } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const wt = mkdtempSync(path.join(tmpdir(), "factory-data-"));
    const orphan = `factory-data-new-${process.pid}-${attempt}-${Date.now()}`;
    try {
      let exists = true;
      try {
        g(root, ["ls-remote", "--exit-code", "--heads", remote, branch]);
      } catch {
        exists = false;
      }
      if (exists) {
        g(root, ["fetch", "--quiet", "--depth=1", remote, `+refs/heads/${branch}:refs/factory-data/tip`]);
        g(root, ["worktree", "add", "--quiet", "--detach", wt, "refs/factory-data/tip"]);
      } else {
        g(root, ["worktree", "add", "--quiet", "--detach", wt, "HEAD"]);
        g(wt, ["checkout", "--quiet", "--orphan", orphan]);
        g(wt, ["rm", "-rfq", "--ignore-unmatch", "."]);
        writeFileSync(path.join(wt, "README.md"), BRANCH_README);
      }
      const files = change(wt);
      g(wt, ["add", "-A"]);
      g(wt, [...BOT, "commit", "--quiet", "--no-verify", "-m", message]);
      g(wt, ["push", "--quiet", remote, `HEAD:refs/heads/${branch}`]);
      return { ok: true, attempt, created: !exists, files };
    } catch (e) {
      lastError = e;
      if (/append-only|refused/.test(String(e.message))) break; // a rule violation, not a race: do not retry
      sleep(Math.min(8000, 500 * attempt + Math.floor(Math.random() * 500)));
    } finally {
      try {
        g(root, ["worktree", "remove", "--force", wt]);
      } catch {
        rmSync(wt, { recursive: true, force: true });
      }
      try {
        g(root, ["worktree", "prune"]);
        g(root, ["branch", "-D", "--quiet", orphan]);
      } catch {
        // housekeeping (the temporary branch exists only when the data branch was new); never affects the push result
      }
    }
  }
  return { ok: false, error: `${lastError?.stderr || lastError?.message || lastError}`.trim() };
}

/** Append lines (append-only: an existing file's old content must stay a prefix of the new content). */
export function pushLines(root, lines, { dir = DIR, ...opts } = {}) {
  const byFile = new Map();
  for (const l of lines) {
    const f = monthFile(dir, l.at);
    byFile.set(f, `${byFile.get(f) ?? ""}${JSON.stringify(l)}\n`);
  }
  return commitToDataBranch(
    root,
    (wt) => {
      for (const [file, text] of byFile) {
        const full = path.join(wt, file);
        mkdirSync(path.dirname(full), { recursive: true });
        const before = existsSync(full) ? readFileSync(full, "utf8") : "";
        appendFileSync(full, (before && !before.endsWith("\n") ? "\n" : "") + text);
        if (!readFileSync(full, "utf8").startsWith(before)) throw new Error(`append-only: ${file} would be rewritten`);
      }
      return [...byFile.keys()];
    },
    { message: `metrics: ${lines.length} line(s)`, ...opts },
  );
}

/** Publish a whole file (retros, reports) to the data branch. Never under metrics/, which is append-only. */
export function publishFile(root, src, dest, opts = {}) {
  if (/^metrics\//.test(dest) || dest.includes(".."))
    return { ok: false, error: `refused: ${dest} is under metrics/ (append-only; use 'record') or leaves the branch` };
  return commitToDataBranch(
    root,
    (wt) => {
      const full = path.join(wt, dest);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, readFileSync(src));
      return [dest];
    },
    { message: `publish ${dest}`, ...opts },
  );
}

export function parseFlags(args) {
  const flags = {};
  const multi = new Set(["extra", "exclude"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (multi.has(key)) flags[key] = [...(flags[key] ?? []), value];
    else flags[key] = value;
  }
  return flags;
}

async function fetchJobs(env) {
  const url = `${env.GITHUB_API_URL || "https://api.github.com"}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT || 1}/jobs?per_page=100`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`jobs API ${res.status}`);
  return res.json();
}

export async function runMetrics(root, args, out, env = process.env) {
  const [cmd, ...rest] = args;
  const flags = parseFlags(rest);
  let lines;
  if (cmd === "record") {
    lines = [buildLine(flags, env)];
  } else if (cmd === "publish") {
    const r = publishFile(root, flags.file, flags.to, { branch: flags.branch || BRANCH, remote: flags.remote || "origin" });
    if (r.ok) {
      out.log(
        `metrics: published ${flags.to} to ${flags.branch || BRANCH} (attempt ${r.attempt}${r.created ? "; branch created" : ""})`,
      );
      return 0;
    }
    (flags.soft ? out.log : out.err)(`metrics: could not publish ${flags.to}: ${r.error}`);
    return flags.soft ? 0 : 1;
  } else if (cmd === "from-run") {
    const jobs = flags["jobs-file"] ? JSON.parse(readFileSync(flags["jobs-file"], "utf8")) : await fetchJobs(env);
    lines = linesFromJobs(jobs, flags, env);
  } else {
    out.err(
      "usage: metrics record --job <name> --result <conclusion> [...] | from-run [--jobs-file f] [--exclude job] | publish --file f --to path",
    );
    return 2;
  }
  const bad = lines.flatMap((l, i) => lineProblems(l).map((p) => `line ${i + 1} (${l.job ?? "?"}): ${p}`));
  if (bad.length) {
    out.err(
      `metrics: FAIL\n${bad.map((b) => `  x ${b}`).join("\n")}\n    fix: pass --job and a --result that is a GitHub job conclusion.`,
    );
    return 1;
  }
  if (flags["dry-run"]) {
    for (const l of lines) out.log(JSON.stringify(l));
    return 0;
  }
  if (flags.local) {
    mkdirSync(path.dirname(path.resolve(flags.local)), { recursive: true });
    appendFileSync(flags.local, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    out.log(`metrics: appended ${lines.length} line(s) to ${flags.local}`);
    return 0;
  }
  const r = pushLines(root, lines, {
    branch: flags.branch || BRANCH,
    remote: flags.remote || "origin",
    dir: flags.dir || DIR,
    message: `metrics: ${lines.length} line(s) from ${lines[0].workflow} run ${lines[0].run_id ?? "local"}`,
  });
  if (r.ok) {
    out.log(
      `metrics: pushed ${lines.length} line(s) to ${flags.branch || BRANCH} (${r.files.join(", ")}; attempt ${r.attempt}${r.created ? "; branch created" : ""})`,
    );
    return 0;
  }
  const msg = `metrics: could not push to ${flags.branch || BRANCH}: ${r.error}. Fix: the job needs 'permissions: contents: write' and the repository must allow the workflow token to write (see docs/runbooks/setup-checklist.md).`;
  if (flags.soft) {
    out.log(env.GITHUB_ACTIONS === "true" ? `::warning title=metrics not recorded::${msg}` : `warning: ${msg}`);
    return 0;
  }
  out.err(msg);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = { log: (s) => console.log(s), err: (s) => console.error(s) };
  process.exitCode = await runMetrics(process.cwd(), process.argv.slice(2), out);
}
