// Holdout scenarios (plan 5.5 L5b). The scenarios live in a separate private repository that building agents cannot read; only
// the nightly (and later the release) workflow checks it out with a deploy key. This module is the deterministic part:
//   holdout validate <scenarios-dir>                      every scenario file matches the format (docs/runbooks/holdout.md)
//   holdout score <scenarios-dir> <results-dir> [--out f] satisfaction per scenario from the judges' grades, 3 clean trials each
//   holdout issues <scenarios-dir> <results-dir> <out-dir> one issue body per failed scenario: symptom and observed steps only,
//                                                          with any scenario or rubric text redacted (and checked) before writing
// The judging itself is done by agents with factory/prompts/holdout-evaluator.md and factory/prompts/holdout-judge.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

/** Rule ids; each has a negative test tagged `@guard holdout/<id>` (doctor checks). */
export const RULES = ["scenario-schema", "trials", "grades", "leak"];

export const TRIALS = 3;
export const GRADES = ["pass", "fail", "unknown"];
export const DIMENSIONS = ["outcome", "navigation", "state", "language", "accessibility", "resilience"];

const ID = /^H-\d{3}$/;

export function scenarioProblems(s, file = "scenario") {
  const p = [];
  if (!s || typeof s !== "object") return [`${file}: not a YAML mapping`];
  if (!ID.test(String(s.id ?? ""))) p.push(`${file}: id must look like H-001`);
  for (const k of ["title", "story", "persona", "start"]) if (!String(s[k] ?? "").trim()) p.push(`${file}: '${k}' is required`);
  if (s.start && !String(s.start).startsWith("/")) p.push(`${file}: 'start' is a path on the staging build, starting with /`);
  if (!Array.isArray(s.rubric) || s.rubric.length < 2) p.push(`${file}: 'rubric' needs at least two lines`);
  const seen = new Set();
  for (const [i, r] of (s.rubric ?? []).entries()) {
    if (!/^R\d+$/.test(String(r?.id ?? ""))) p.push(`${file}: rubric[${i}].id must look like R1`);
    if (seen.has(r?.id)) p.push(`${file}: rubric id ${r.id} appears twice`);
    seen.add(r?.id);
    if (!DIMENSIONS.includes(r?.dimension)) p.push(`${file}: rubric[${i}].dimension must be one of ${DIMENSIONS.join(", ")}`);
    if (String(r?.line ?? "").trim().length < 10) p.push(`${file}: rubric[${i}].line must state an observable result`);
  }
  return p;
}

export function loadScenarios(dir) {
  const scenarios = [];
  const problems = [];
  if (!existsSync(dir)) return { scenarios, problems: [`${dir} does not exist`] };
  for (const f of readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()) {
    try {
      const s = YAML.parse(readFileSync(path.join(dir, f), "utf8"));
      const p = scenarioProblems(s, f);
      problems.push(...p);
      if (!p.length) scenarios.push(s);
    } catch (e) {
      problems.push(`${f}: not valid YAML (${e.message})`);
    }
  }
  if (!scenarios.length && !problems.length) problems.push(`${dir} has no scenario files`);
  return { scenarios, problems };
}

/** Results: one JSON per trial, `<scenario>-t<n>.json`: { scenario, trial, clean, grades: [{ rubric, grade, note }], observed: [..] }. */
export function loadResults(dir) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }))
    : [];
}

/** Satisfaction per scenario: share of clean trials in which every rubric line was graded pass. Unknown is not a pass. */
export function score(scenarios, results) {
  const problems = [];
  const out = [];
  for (const s of scenarios) {
    const trials = results.filter((r) => r.scenario === s.id);
    const clean = trials.filter((t) => t.clean === true);
    if (clean.length !== TRIALS)
      problems.push(
        `${s.id}: ${clean.length} clean trial(s), need exactly ${TRIALS} (a trial is clean when it starts from a reset environment and a fresh browser context)`,
      );
    let satisfied = 0;
    for (const t of clean) {
      const grades = new Map((t.grades ?? []).map((g) => [g.rubric, g.grade]));
      for (const g of t.grades ?? [])
        if (!GRADES.includes(g.grade))
          problems.push(`${s.id} trial ${t.trial}: grade '${g.grade}' for ${g.rubric} is not pass, fail or unknown`);
      const missing = s.rubric.filter((r) => !grades.has(r.id)).map((r) => r.id);
      if (missing.length) problems.push(`${s.id} trial ${t.trial}: no grade for ${missing.join(", ")}`);
      if (s.rubric.every((r) => grades.get(r.id) === "pass")) satisfied++;
    }
    out.push({
      scenario: s.id,
      trials: clean.length,
      satisfied,
      satisfaction: clean.length ? satisfied / clean.length : 0,
      unknown: clean.reduce((n, t) => n + (t.grades ?? []).filter((g) => g.grade === "unknown").length, 0),
    });
  }
  const total = out.reduce((n, r) => n + r.trials, 0);
  return {
    scenarios: out,
    satisfaction: total ? out.reduce((n, r) => n + r.satisfied, 0) / total : 0,
    problems,
  };
}

/** Sentences and rubric lines of a scenario: the text an issue must never contain. */
function secretFragments(s) {
  const parts = [s.title, s.story, ...(s.rubric ?? []).map((r) => r.line)]
    .flatMap((t) => String(t ?? "").split(/(?<=[.!?;:])\s+|\n+/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 16);
  return [...new Set(parts)].sort((a, b) => b.length - a.length);
}

export function redact(text, s) {
  let out = String(text ?? "");
  for (const frag of secretFragments(s)) out = out.split(frag).join("[redacted: scenario text]");
  return out;
}

export const leaks = (text, s) => secretFragments(s).filter((f) => String(text).includes(f));

export function issueBodies(scenarios, results) {
  const out = [];
  for (const s of scenarios) {
    const failed = results.filter(
      (r) => r.scenario === s.id && r.clean === true && (r.grades ?? []).some((g) => g.grade !== "pass"),
    );
    if (!failed.length) continue;
    const symptoms = failed.flatMap((t) =>
      (t.grades ?? []).filter((g) => g.grade !== "pass").map((g) => `- ${g.grade}: ${g.note ?? "no note"}`),
    );
    const steps = failed[0].observed ?? [];
    const body = redact(
      [
        `A holdout scenario failed in ${failed.length} of ${TRIALS} clean trial(s) on the staging build.`,
        "This issue describes what was observed; the scenario and its rubric stay in the holdout repository (plan 5.5).",
        "",
        "### Symptom",
        ...symptoms,
        "",
        "### Steps observed (first failing trial)",
        ...steps.map((x, i) => `${i + 1}. ${x}`),
        "",
        `Scenario reference: ${s.id} (ask a holdout owner; do not paste scenario text here).`,
      ].join("\n"),
      s,
    );
    out.push({ scenario: s.id, title: `Holdout ${s.id}: failed on staging`, body, leaks: leaks(body, s) });
  }
  return out;
}

export function runHoldout(_root, args, out) {
  const [cmd, scenDir, resDir, outDir] = args.filter((a) => !a.startsWith("--"));
  const opt = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  if (!["validate", "score", "issues"].includes(cmd) || !scenDir) {
    out.err(
      "usage: holdout validate <scenarios> | holdout score <scenarios> <results> [--out f] | holdout issues <scenarios> <results> <out-dir>",
    );
    return 2;
  }
  const { scenarios, problems } = loadScenarios(scenDir);
  if (problems.length) {
    out.err(
      `holdout: FAIL\n${problems.map((p) => `  x ${p}`).join("\n")}\n    fix: see the scenario format in docs/runbooks/holdout.md.`,
    );
    return 1;
  }
  if (cmd === "validate") {
    out.log(`holdout: PASS (${scenarios.length} scenario(s) valid; text not printed)`);
    return 0;
  }
  const results = loadResults(resDir);
  if (cmd === "score") {
    const r = score(scenarios, results);
    if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify(r, null, 2));
    for (const s of r.scenarios)
      out.log(
        `  ${s.scenario}: ${s.satisfied}/${s.trials} trials satisfied${s.unknown ? ` (${s.unknown} unknown grade(s))` : ""}`,
      );
    out.log(`holdout: satisfaction ${(100 * r.satisfaction).toFixed(0)}%`);
    if (r.problems.length) {
      out.err(
        `holdout: FAIL\n${r.problems.map((p) => `  x ${p}`).join("\n")}\n    fix: rerun the evaluator so every scenario has ${TRIALS} clean trials and every rubric line a grade.`,
      );
      return 1;
    }
    return 0;
  }
  const bodies = issueBodies(scenarios, results);
  const leaking = bodies.filter((b) => b.leaks.length);
  if (leaking.length) {
    out.err(
      `holdout: FAIL\n  x issue bodies for ${leaking.map((b) => b.scenario).join(", ")} still contain scenario text after redaction\n    fix: this is a bug in redact(); no issue is written.`,
    );
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  for (const b of bodies) writeFileSync(path.join(outDir, `${b.scenario}.md`), `${b.title}\n\n${b.body}\n`);
  out.log(`holdout: ${bodies.length} issue body(ies) written to ${outDir}`);
  return 0;
}
