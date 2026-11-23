// Test-system health checks for the nightly (plan 5.5, 5.8). Commands:
//   collection <report.json> …   the test files on disk equal the test files executed, per level (Vitest and Playwright
//                                JSON reports). A test file that no runner collects is the classic silent hole.
//   flake <run1.json> <run2.json> <run3.json> …   the same suite run several times: list tests with mixed results.
//   quarantine [--report <vitest.json>]   validate factory/quarantine.yaml (fields, expiry); with a report, failures of
//                                quarantined tests are notices and any other failure fails.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { readText, walk } from "./lib/repo.mjs";
import { matchAny } from "./lib/glob.mjs";

/** Rule ids; each has a negative test tagged `@guard test-health/<id>` (doctor checks). */
export const RULES = ["collection", "flake", "quarantine-schema", "quarantine-expired", "quarantine-gate"];

export const QUARANTINE_FILE = "factory/quarantine.yaml";
export const QUARANTINE_MAX_DAYS = 30;

/** Test levels by path. A test file outside every level is reported as `unclassified` (it runs nowhere). */
export const LEVELS = [
  { level: "L0", name: "architecture", globs: ["test/architecture/**"] },
  { level: "L0", name: "factory", globs: ["factory/test/**"] },
  { level: "L1", name: "unit", globs: ["app/src/**", "packages/*/src/**"] },
  { level: "L2", name: "integration", globs: ["test/integration/**"] },
  { level: "L3", name: "contract", globs: ["test/contract/**"] },
  { level: "L4a", name: "e2e", globs: ["e2e/**"] },
];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|mjs|js)$/;
const IGNORE_DIRS = ["**/fixtures/**", "**/__fixtures__/**"];

export const levelOf = (file) => LEVELS.find((l) => matchAny(l.globs, file))?.name ?? "unclassified";

const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

/** Files and per-test statuses from a Vitest or Playwright JSON report. */
export function parseReport(root, json) {
  const files = new Set();
  const tests = new Map(); // id -> status
  if (Array.isArray(json.testResults)) {
    for (const f of json.testResults) {
      const file = rel(root, f.name);
      files.add(file);
      for (const a of f.assertionResults ?? [])
        tests.set(`${file} > ${[...(a.ancestorTitles ?? []), a.title].join(" > ")}`, a.status);
    }
  }
  const walkSuites = (suites, file) => {
    for (const s of suites ?? []) {
      const f = s.file ? s.file.replace(/^\.?\/?/, "") : file;
      if (f) files.add(f.startsWith("e2e/") ? f : `e2e/${f}`);
      for (const spec of s.specs ?? [])
        for (const t of spec.tests ?? []) {
          const last = (t.results ?? []).at(-1)?.status;
          tests.set(
            `${f.startsWith("e2e/") ? f : `e2e/${f}`} > ${spec.title} [${t.projectName ?? ""}]`,
            last === "passed" ? "passed" : last === "skipped" ? "skipped" : "failed",
          );
        }
      walkSuites(s.suites, f);
    }
  };
  if (Array.isArray(json.suites)) walkSuites(json.suites);
  return { files, tests };
}

export function collectionCheck(root, reports) {
  const onDisk = walk(root).filter((f) => TEST_FILE.test(f) && !matchAny(IGNORE_DIRS, f));
  const executed = new Set();
  for (const r of reports) for (const f of parseReport(root, r).files) executed.add(f);
  const byLevel = {};
  for (const f of onDisk) {
    const l = levelOf(f);
    byLevel[l] ??= { onDisk: 0, executed: 0, missing: [] };
    byLevel[l].onDisk++;
    if (executed.has(f)) byLevel[l].executed++;
    else byLevel[l].missing.push(f);
  }
  const missing = Object.values(byLevel).flatMap((l) => l.missing);
  return { byLevel, missing, ok: missing.length === 0 };
}

export function flakeCheck(root, reports, quarantined = []) {
  const runs = reports.map((r) => parseReport(root, r).tests);
  const ids = new Set(runs.flatMap((m) => [...m.keys()]));
  const flaky = [];
  for (const id of ids) {
    const statuses = runs.map((m) => m.get(id) ?? "missing");
    const set = new Set(statuses.filter((s) => s !== "skipped"));
    if (set.size > 1) flaky.push({ test: id, statuses, quarantined: quarantined.includes(id) });
  }
  return { runs: runs.length, tests: ids.size, flaky, newFlaky: flaky.filter((f) => !f.quarantined) };
}

export function loadQuarantine(root, today = new Date()) {
  const problems = [];
  const expired = [];
  const text = readText(root, QUARANTINE_FILE);
  if (text === null) return { entries: [], problems: [`${QUARANTINE_FILE} is missing`], expired };
  let data;
  try {
    data = YAML.parse(text) ?? {};
  } catch (e) {
    return { entries: [], problems: [`${QUARANTINE_FILE} is not valid YAML: ${e.message}`], expired };
  }
  const entries = data.quarantine ?? [];
  if (!Array.isArray(entries)) return { entries: [], problems: ["`quarantine` must be a list"], expired };
  const day = (d) => (typeof d === "string" || d instanceof Date ? new Date(d) : new Date(NaN));
  entries.forEach((e, i) => {
    const at = `entry ${i + 1}${e?.test ? ` (${e.test})` : ""}`;
    if (!e?.test) problems.push(`${at} has no 'test' (full name: "<file> > <describe> > <title>")`);
    if (!e?.reason || String(e.reason).trim().length < 10) problems.push(`${at} needs a 'reason' that says what flakes`);
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(String(e?.issue ?? "")))
      problems.push(`${at} needs an 'issue' link (https://github.com/<org>/<repo>/issues/<n>)`);
    const added = day(e?.added);
    const expires = day(e?.expires);
    if (Number.isNaN(added.getTime()) || Number.isNaN(expires.getTime()))
      problems.push(`${at} needs 'added' and 'expires' dates`);
    else {
      if ((expires - added) / 86_400_000 > QUARANTINE_MAX_DAYS)
        problems.push(`${at} expires more than ${QUARANTINE_MAX_DAYS} days after it was added`);
      if (expires < today) expired.push(`${at} expired on ${String(e.expires).slice(0, 10)}`);
    }
  });
  return { entries, problems, expired };
}

const readJsonFile = (f) => JSON.parse(readFileSync(f, "utf8"));
const files = (args) => args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--report"].includes(args[i - 1])));
const opt = (args, f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);

export function runCollection(root, args, out) {
  const reports = files(args).map(readJsonFile);
  if (!reports.length) {
    out.err("usage: collection <vitest-or-playwright-report.json> … [--out summary.json]");
    return 2;
  }
  const r = collectionCheck(root, reports);
  for (const [l, v] of Object.entries(r.byLevel)) out.log(`  ${l}: ${v.onDisk} on disk, ${v.executed} executed`);
  if (opt(args, "--out")) writeFileSync(opt(args, "--out"), JSON.stringify(r, null, 2));
  if (r.ok) {
    out.log("collection: PASS (every test file on disk was executed)");
    return 0;
  }
  out.err(
    `collection: FAIL\n${r.missing.map((f) => `  x ${f} (${levelOf(f)}) is on disk but was not executed`).join("\n")}\n    fix: make a Vitest project or the Playwright testDir include it (vitest.config.ts, playwright.config.ts), or delete it; 'unclassified' files also need a level in factory/test-health.mjs.`,
  );
  return 1;
}

export function runFlake(root, args, out) {
  const reports = files(args).map(readJsonFile);
  if (reports.length < 2) {
    out.err("usage: flake <run1.json> <run2.json> [<run3.json> …] [--out summary.json]");
    return 2;
  }
  const q = loadQuarantine(root).entries.map((e) => e.test);
  const r = flakeCheck(root, reports, q);
  if (opt(args, "--out")) writeFileSync(opt(args, "--out"), JSON.stringify(r, null, 2));
  for (const f of r.flaky) out.log(`  ${f.quarantined ? "quarantined" : "FLAKY"}: ${f.test} (${f.statuses.join(", ")})`);
  if (!r.newFlaky.length) {
    out.log(`flake: PASS (${r.tests} tests over ${r.runs} runs; ${r.flaky.length} quarantined flaky)`);
    return 0;
  }
  out.err(
    `flake: FAIL (${r.newFlaky.length} test(s) with mixed results over ${r.runs} runs)\n    fix: fix the test (polling waits, no shared state), or quarantine it in ${QUARANTINE_FILE} with a reason, an issue and an expiry.`,
  );
  return 1;
}

export function runQuarantine(root, args, out, today = new Date()) {
  const q = loadQuarantine(root, today);
  const bad = [...q.problems, ...q.expired];
  if (opt(args, "--report")) {
    const names = new Set(q.entries.map((e) => e.test));
    const { tests } = parseReport(root, readJsonFile(opt(args, "--report")));
    for (const [id, status] of tests) {
      if (status !== "failed") continue;
      if (names.has(id)) out.log(`  notice: quarantined test failed (does not gate): ${id}`);
      else bad.push(`${id} failed and is not quarantined`);
    }
  }
  if (!bad.length) {
    out.log(`quarantine: PASS (${q.entries.length} entr${q.entries.length === 1 ? "y" : "ies"})`);
    return 0;
  }
  out.err(
    `quarantine: FAIL\n${bad.map((b) => `  x ${b}`).join("\n")}\n    fix: fix the entry in ${QUARANTINE_FILE}; an expired entry means the flaky test must be fixed or a human renews it.`,
  );
  return 1;
}
