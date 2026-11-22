// `npm run factory -- retro --metrics <dir> [--retros <dir>] [--week YYYY-Www] [--out <file>] [--fixture]`
// The deterministic half of the weekly retro (plan 5.9): the numbers, the state of past action items, and recurring problems,
// computed from the metrics store (factory-data `metrics/*.jsonl`), the last four retros and factory/quarantine.yaml. The retro
// agent (retro.yml) then writes the narrative sections under the numbers; it never recomputes them.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readMetrics } from "./metrics.mjs";
import { loadQuarantine } from "./test-health.mjs";

/** Rule ids; each has a negative test tagged `@guard retro/<id>` (doctor checks). */
export const RULES = ["metrics-valid", "action-items"];

/** ISO week of a date, e.g. "2026-W48". */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

export function weekStats(lines) {
  const jobs = new Map();
  for (const l of lines) {
    const k = `${l.workflow} / ${l.job}`;
    if (!jobs.has(k)) jobs.set(k, []);
    jobs.get(k).push(l);
  }
  const perJob = [...jobs.entries()]
    .map(([k, ls]) => ({
      job: k,
      runs: ls.length,
      failures: ls.filter((l) => ["failure", "timed_out"].includes(l.result)).length,
      skipped: ls.filter((l) => l.result === "skipped").length,
      median_s: median(ls.map((l) => l.duration_s)),
    }))
    .sort((a, b) => a.job.localeCompare(b.job));
  const x = (key) => lines.map((l) => l.extra?.[key]).filter((v) => v !== undefined);
  return {
    runs: lines.length,
    perJob,
    skippedNoCredentials: lines.filter((l) => l.result === "skipped" && l.extra?.reason === "credentials").length,
    review: { critical: sum(x("critical")), high: sum(x("high")), medium: sum(x("medium")), overridden: sum(x("overridden")) },
    qa: {
      pass: sum(x("qa_pass")),
      recovered: sum(x("qa_recovered")),
      cannotReach: sum(x("qa_cannot_reach")),
      gaps: sum(x("planner_gaps")),
    },
    flaky: sum(x("flaky")),
    mutation: x("mutation_score").map(Number).filter(Number.isFinite),
    tokens: sum(lines.map((l) => (l.tokens?.input ?? 0) + (l.tokens?.output ?? 0))),
    cost: sum(lines.map((l) => l.cost_usd ?? 0)),
  };
}

/** Action items from a retro file: lines "- [ ] …" / "- [x] …" / "- [~] …" (dropped) under the "## Action items" heading. */
export function actionItems(text) {
  const items = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (/^##\s/.test(line)) inSection = /^##\s+action items/i.test(line);
    const m = inSection && line.match(/^\s*-\s*\[([ xX~])\]\s*(.+)$/);
    if (m) items.push({ done: m[1].toLowerCase() === "x", dropped: m[1] === "~", text: m[2].trim() });
  }
  return items;
}

/** QA promotion candidates (plan 5.5): surfaces whose last 20+ QA runs had no false failure. */
export function promotionCandidates(all, threshold = 20) {
  const bySurface = new Map();
  for (const l of all.filter((l) => l.extra?.surface && l.job === "qa")) {
    if (!bySurface.has(l.extra.surface)) bySurface.set(l.extra.surface, []);
    bySurface.get(l.extra.surface).push(l);
  }
  const out = [];
  for (const [s, ls] of bySurface) {
    ls.sort((a, b) => a.at.localeCompare(b.at));
    let streak = 0;
    for (const l of ls) streak = String(l.extra.false_failure) === "true" ? 0 : streak + 1;
    if (streak >= threshold) out.push({ surface: s, streak });
  }
  return out;
}

export function buildRetro({ metricsDir, retrosDir, root, week, fixture = false, today = new Date() }) {
  const { lines, problems } = readMetrics(metricsDir);
  const thisWeek = week ?? isoWeek(today);
  const weekOf = (l) => isoWeek(new Date(l.at));
  const cur = lines.filter((l) => weekOf(l) === thisWeek);
  const prevWeek = [...new Set(lines.map(weekOf))]
    .sort()
    .filter((w) => w < thisWeek)
    .pop();
  const s = weekStats(cur);
  const p = weekStats(prevWeek ? lines.filter((l) => weekOf(l) === prevWeek) : []);

  const past =
    retrosDir && existsSync(retrosDir)
      ? readdirSync(retrosDir)
          .filter((f) => /^\d{4}-W\d{2}\.md$/.test(f) && f.slice(0, 8) < thisWeek)
          .sort()
          .slice(-4)
      : [];
  const items = past.flatMap((f) =>
    actionItems(readFileSync(path.join(retrosDir, f), "utf8")).map((i) => ({ ...i, from: f.slice(0, 8) })),
  );

  // Recurring problems: a job that failed in more than one week, with the number of weeks seen.
  const failingWeeks = new Map();
  for (const l of lines.filter((l) => ["failure", "timed_out"].includes(l.result) && weekOf(l) <= thisWeek)) {
    const k = `${l.workflow} / ${l.job}`;
    if (!failingWeeks.has(k)) failingWeeks.set(k, new Set());
    failingWeeks.get(k).add(weekOf(l));
  }
  const recurring = [...failingWeeks.entries()]
    .filter(([, ws]) => ws.size > 1)
    .map(([k, ws]) => `${k}: failed in ${ws.size} weeks (${[...ws].sort().join(", ")})`);

  const q = root ? loadQuarantine(root, today) : { entries: [], expired: [] };
  const candidates = promotionCandidates(lines);
  const delta = prevWeek ? ` (${s.runs - p.runs >= 0 ? "+" : ""}${s.runs - p.runs} vs ${prevWeek})` : "";
  const md = [
    `# Retro ${thisWeek}`,
    "",
    ...(fixture
      ? [
          "> **FIXTURE RUN.** Produced by `npm run factory -- retro --fixture` on the sample metrics in",
          "> `factory/test/fixtures/metrics/`, not on real CI data. It shows the format. Real retros are written weekly by",
          "> `retro.yml` to the `factory-data` branch (`retros/`).",
          "",
        ]
      : []),
    `Generated by \`npm run factory -- retro\` from ${lines.length} metrics line(s)${problems.length ? ` (${problems.length} invalid line(s), listed below)` : ""}. The numbers are computed; the retro agent writes the sections from "Narrative" on.`,
    "",
    "## Numbers",
    "",
    `- CI job runs this week: ${s.runs}${delta}`,
    `- Agent lanes skipped for missing credentials: ${s.skippedNoCredentials}`,
    `- Review findings: ${s.review.critical} critical, ${s.review.high} high, ${s.review.medium} medium; overridden by a human: ${s.review.overridden}`,
    `- Agent QA: ${s.qa.pass} pass, ${s.qa.recovered} failed-then-recovered, ${s.qa.cannotReach} cannot-reach; planner gaps: ${s.qa.gaps}`,
    `- Flaky tests found by the nightly: ${s.flaky}; quarantined now: ${q.entries.length}${q.expired.length ? ` (${q.expired.length} expired)` : ""}`,
    `- Mutation score on changed code: ${!s.mutation.length ? "no run" : Math.min(...s.mutation) === Math.max(...s.mutation) ? `${s.mutation[0]}%` : `${Math.min(...s.mutation)}–${Math.max(...s.mutation)}%`}`,
    `- Tokens: ${s.tokens}; cost: $${s.cost.toFixed(2)}`,
    "",
    "| Job | Runs | Failure rate | Skipped | Median duration |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...s.perJob.map(
      (j) => `| ${j.job} | ${j.runs} | ${pct(j.failures, j.runs - j.skipped)} | ${j.skipped} | ${j.median_s ?? "n/a"} s |`,
    ),
    "",
    "## Past action items",
    "",
    ...(items.length
      ? items.map((i) => `- ${i.done ? "done" : i.dropped ? "dropped" : "NOT DONE"} (${i.from}): ${i.text}`)
      : ["- none recorded in the last four retros"]),
    "",
    "## Recurring problems",
    "",
    ...(recurring.length ? recurring.map((r) => `- ${r}`) : ["- none (no job failed in more than one week)"]),
    "",
    "## QA promotion candidates",
    "",
    ...(candidates.length
      ? candidates.map(
          (x) =>
            `- ${x.surface}: ${x.streak} consecutive runs with no false failure. Proposal: make agent QA required for it (a human decides).`,
        )
      : ["- none (a surface needs 20 consecutive QA runs with no false failure)"]),
    "",
    ...(problems.length ? ["## Invalid metrics lines", "", ...problems.map((x) => `- ${x}`), ""] : []),
    "## Narrative",
    "",
    "_Written by the retro agent: what changed in the numbers and why; at most three issues, each with an owner or `unassigned`; rejected proposals with their reasons._",
    "",
    "## Action items",
    "",
    "_The retro agent lists new items as `- [ ] item (owner)`; next week's retro reports each as done, not done or dropped._",
    "",
  ].join("\n");
  return { md, week: thisWeek, problems, stats: s };
}

export function runRetro(root, args, out) {
  const opt = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  const metricsDir = opt("--metrics");
  if (!metricsDir) {
    out.err("usage: retro --metrics <dir> [--retros <dir>] [--week YYYY-Www] [--out <file>] [--fixture]");
    return 2;
  }
  const r = buildRetro({
    metricsDir,
    retrosDir: opt("--retros"),
    root: args.includes("--fixture") ? null : root, // a fixture run does not read this repository's live quarantine list
    week: opt("--week"),
    fixture: args.includes("--fixture"),
  });
  if (opt("--out")) writeFileSync(opt("--out"), r.md);
  else out.log(r.md);
  out.log(`retro: wrote ${r.week}${opt("--out") ? ` to ${opt("--out")}` : ""} (${r.stats.runs} job run(s) this week)`);
  if (r.problems.length) {
    out.err(
      `retro: FAIL\n  x ${r.problems.length} invalid metrics line(s), listed in the retro\n    fix: correct the writer that produced them (factory/metrics.mjs validates every line it writes).`,
    );
    return 1;
  }
  return 0;
}
