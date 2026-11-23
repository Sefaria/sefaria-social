// `npm run factory -- qa-recount <evidence.json> [--surfaces <surfaces.json>] [--comment <out.md>] [--issues <dir>]`
// The deterministic half of the skeptic (plan 5.5 L5a): recount the QA runner's results from its own evidence, apply what
// a pass means, and render the one evidence comment and one issue body per failure. The skeptic agent then reads the same
// evidence and names any assertion that would pass with the feature broken; this script does the counting it must not trust
// an agent to do.
//
// What a pass means:
// - pass: the last attempt passed, no attempt failed, and the journey carries at least one evidence line from the runner's
//   own browser or API session.
// - failed-then-recovered: an attempt failed and a later one passed. Reported as such, never as a pass.
// - cannot-reach: the surface could not be reached (environment not built, route missing); the reason is required. Never a pass.
// - fail: the last attempt failed, or it "passed" with no evidence line.
// - not-run: no attempt recorded.
// A derived surface with zero journeys blocks the report. A journey on a surface the plan did not list is a planner gap.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Rule ids; each has a negative test tagged `@guard qa/<id>` (doctor checks). */
export const RULES = ["evidence", "recovered-not-pass", "cannot-reach-not-pass", "surface-without-journey", "claim-mismatch"];

export const VERDICTS = ["pass", "failed-then-recovered", "cannot-reach", "fail", "not-run"];

export function evidenceProblems(ev) {
  const p = [];
  if (!ev || typeof ev !== "object") return ["evidence must be a JSON object"];
  if (!Array.isArray(ev.journeys)) p.push("`journeys` must be an array");
  for (const [i, j] of (ev.journeys ?? []).entries()) {
    const at = `journeys[${i}]${j?.id ? ` (${j.id})` : ""}`;
    if (!j?.id || !j?.surface || !j?.persona || !j?.title) p.push(`${at} needs id, surface, persona and title`);
    if (!Array.isArray(j?.attempts)) p.push(`${at}.attempts must be an array`);
    for (const [k, a] of (j?.attempts ?? []).entries())
      if (!["pass", "fail"].includes(a?.outcome)) p.push(`${at}.attempts[${k}].outcome must be 'pass' or 'fail'`);
    if (j?.cannot_reach !== undefined && j.cannot_reach !== null && !String(j.cannot_reach).trim())
      p.push(`${at}.cannot_reach needs a reason`);
  }
  return p;
}

/** Verdict for one journey, with the rule that decided it. */
export function verdict(j) {
  if (j.cannot_reach) return { verdict: "cannot-reach", rule: "cannot-reach-not-pass", why: String(j.cannot_reach) };
  const attempts = j.attempts ?? [];
  if (!attempts.length) return { verdict: "not-run", why: "no attempt recorded" };
  const last = attempts[attempts.length - 1];
  if (last.outcome === "fail") return { verdict: "fail", why: last.note || "the last attempt failed" };
  const evidence = (last.evidence ?? []).filter((l) => String(l).trim());
  if (!evidence.length)
    return { verdict: "fail", rule: "evidence", why: "marked pass with no evidence line from the runner's own session" };
  if (attempts.some((a) => a.outcome === "fail"))
    return {
      verdict: "failed-then-recovered",
      rule: "recovered-not-pass",
      why: `failed on attempt ${attempts.findIndex((a) => a.outcome === "fail") + 1}, passed on attempt ${attempts.length}`,
    };
  return { verdict: "pass", why: evidence[0] };
}

/**
 * Recount. `derived` is the surfaces the diff maps to (factory surfaces --json), or null to skip that check.
 * Returns { counts, journeys:[{...j, verdict, why, rule}], blocked:[msg], gaps:[msg], mismatches:[msg], status }.
 */
export function recount(ev, derived = null) {
  const journeys = (ev.journeys ?? []).map((j) => ({ ...j, ...verdict(j) }));
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const j of journeys) counts[j.verdict]++;
  const blocked = [];
  const surfaces = derived ? Object.keys(derived.surfaces ?? derived) : [];
  for (const s of surfaces)
    if (!journeys.some((j) => j.surface === s))
      blocked.push(`surface '${s}' changed in this PR but has zero journeys; the report is blocked until it is tested`);
  const planned = new Set(ev.planned_surfaces ?? []);
  const gaps = journeys
    .filter((j) => j.planned === false || (planned.size && !planned.has(j.surface)))
    .map((j) => `${j.id} on '${j.surface}' was not in the plan (planner gap)`);
  const mismatches = [];
  for (const [k, n] of Object.entries(ev.claimed ?? {}))
    if (counts[k] !== undefined && counts[k] !== n) mismatches.push(`runner claimed ${n} ${k}, recount finds ${counts[k]}`);
  const status = blocked.length
    ? "BLOCKED"
    : journeys.length && counts.pass === journeys.length && !mismatches.length
      ? "PASS"
      : counts.fail || counts["not-run"] || mismatches.length
        ? "FAIL"
        : "INCOMPLETE";
  return { counts, journeys, blocked, gaps, mismatches, status };
}

export function renderComment(r, { sha = "", skeptic = "" } = {}) {
  const row = (j) =>
    `| ${j.id} | ${j.surface} | ${j.persona} | ${j.verdict} | ${String(j.why).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`;
  return [
    `## Agent QA: ${r.status}${sha ? ` (${sha.slice(0, 10)})` : ""}`,
    "",
    `Recount (factory/qa.mjs, not the runner's own summary): ${VERDICTS.map((v) => `${r.counts[v]} ${v}`).join(", ")}.`,
    "A retry after a failure is reported as failed-then-recovered, and an unreachable surface as cannot-reach; neither is a pass.",
    "",
    "| Journey | Surface | Persona | Verdict | Evidence or reason |",
    "| --- | --- | --- | --- | --- |",
    ...r.journeys.map(row),
    "",
    ...(r.blocked.length ? ["**Blocked:**", ...r.blocked.map((b) => `- ${b}`), ""] : []),
    ...(r.mismatches.length ? ["**Recount differs from the runner's claim:**", ...r.mismatches.map((m) => `- ${m}`), ""] : []),
    ...(r.gaps.length ? ["**Planner gaps:**", ...r.gaps.map((g) => `- ${g}`), ""] : []),
    ...(skeptic.trim() ? ["### Skeptic", "", skeptic.trim(), ""] : []),
    "_Advisory (plan 5.5): agent QA becomes a required check for a surface only after 20 consecutive runs with no false failure, by a human decision._",
  ].join("\n");
}

export function issueBodies(r, { pr = "", sha = "" } = {}) {
  return r.journeys
    .filter((j) => ["fail", "not-run", "failed-then-recovered"].includes(j.verdict))
    .map((j) => ({
      file: `${j.id}.md`,
      title: `QA ${j.verdict}: ${j.title} (${j.surface}${pr ? `, PR #${pr}` : ""})`,
      body: [
        `Agent QA journey **${j.id}** on surface \`${j.surface}\` as persona \`${j.persona}\`: **${j.verdict}**.`,
        "",
        `- PR: ${pr ? `#${pr}` : "n/a"}; commit: ${sha || "n/a"}`,
        `- Reason: ${j.why}`,
        `- Attempts: ${(j.attempts ?? []).map((a, i) => `${i + 1}=${a.outcome}`).join(", ") || "none"}`,
        "",
        "Transcript:",
        "",
        "```",
        String(j.transcript ?? "(the runner recorded no transcript)").slice(0, 20000),
        "```",
      ].join("\n"),
    }));
}

export function runQa(_root, args, out) {
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
  if (!file) {
    out.err(
      "usage: qa-recount <evidence.json> [--surfaces <surfaces.json>] [--comment <out.md>] [--skeptic <skeptic.md>] [--issues <dir>]",
    );
    return 2;
  }
  let ev;
  try {
    ev = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    out.err(
      `qa-recount: FAIL\n  x cannot read ${file}: ${e.message}\n    fix: the runner writes its evidence as JSON (format: e2e/qa/README.md).`,
    );
    return 1;
  }
  const problems = evidenceProblems(ev);
  if (problems.length) {
    out.err(
      `qa-recount: FAIL\n${problems.map((p) => `  x ${p}`).join("\n")}\n    fix: see the evidence format in e2e/qa/README.md.`,
    );
    return 1;
  }
  const derived = get("--surfaces") ? JSON.parse(readFileSync(get("--surfaces"), "utf8")) : null;
  const r = recount(ev, derived);
  const skeptic = get("--skeptic") ? readFileSync(get("--skeptic"), "utf8") : "";
  const comment = renderComment(r, { sha: ev.sha, skeptic });
  if (get("--comment")) writeFileSync(get("--comment"), `${comment}\n`);
  if (get("--issues")) {
    mkdirSync(get("--issues"), { recursive: true });
    for (const b of issueBodies(r, { pr: ev.pr, sha: ev.sha }))
      writeFileSync(path.join(get("--issues"), b.file), `${b.title}\n\n${b.body}\n`);
  }
  out.log(`qa-recount: ${r.status} (${VERDICTS.map((v) => `${r.counts[v]} ${v}`).join(", ")})`);
  for (const b of r.blocked) out.log(`  blocked: ${b}`);
  for (const m of r.mismatches) out.log(`  mismatch: ${m}`);
  for (const g of r.gaps) out.log(`  gap: ${g}`);
  return r.status === "PASS" ? 0 : 1;
}
