// `npm run factory -- prove-red --base <ref>`: red before green (plan 5.5 rule 2).
// Every new or changed test tagged `// @ac NNN/AC-xxx` must FAIL on the merge base, and fail for an assertion reason, not
// because an import is missing or the code threw. A test that passes without the feature proves nothing.
// Runs the PR's versions of the changed test files inside a temporary worktree of the merge base (CI only; not a hook).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedFiles, git, mergeBase, readAtRef, readText, resolveRef, tryGit } from "./lib/repo.mjs";
import { isTestFile } from "./lib/paths.mjs";

/** Rule ids; each has a negative test tagged `@guard prove-red/<id>` (doctor checks). */
export const RULES = ["red-on-base", "right-reason", "loads-on-base"];

/** Failure messages that count as "the assertion failed". */
const ASSERTION = /^(AssertionError|TestingLibraryElementError)\b|^Error: expect\(/;

/** Tagged tests in a file: [{ title, acs, body }]. A tag applies to the next it()/test() call. */
export function parseAcTests(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const tests = [];
  let pending = [];
  const callRe = /\b(?:it|test)(?:\.(?:only|concurrent|fails))?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/;
  for (let i = 0; i < lines.length; i++) {
    const tag = lines[i].match(/^\s*(?:\/\/|\*|\/\*)\s*@ac\s+(\d{3}\/AC-\d{3}(?:[\s,]+\d{3}\/AC-\d{3})*)/);
    if (tag) {
      pending.push(...tag[1].split(/[\s,]+/));
      continue;
    }
    const call = lines[i].match(callRe);
    if (call && pending.length) {
      let end = i + 1;
      while (end < lines.length && !callRe.test(lines[end]) && !/@ac\s/.test(lines[end])) end++;
      tests.push({ title: call[2], acs: pending, body: lines.slice(i, end).join("\n") });
      pending = [];
    }
  }
  return tests;
}

function linkNodeModules(root, wt) {
  const dirs = [
    "",
    "app",
    "harness",
    ...(tryGit(root, ["ls-files", "packages/*/package.json"]) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((p) => path.dirname(p)),
  ];
  for (const d of dirs) {
    const src = path.join(root, d, "node_modules");
    const dst = path.join(wt, d, "node_modules");
    if (existsSync(src) && !existsSync(dst) && existsSync(path.join(wt, d || "."))) symlinkSync(src, dst, "dir");
  }
}

export function proveRed(root, opts) {
  const baseSha = resolveRef(root, opts.base);
  const headSha = resolveRef(root, opts.head ?? "HEAD");
  const mb = mergeBase(root, baseSha, headSha);
  const candidates = changedFiles(root, baseSha, headSha).filter(
    (f) => f.status !== "D" && isTestFile(f.path) && !f.path.startsWith("e2e/"),
  );
  const targets = [];
  for (const f of candidates) {
    const headText = readText(root, f.path) ?? "";
    const baseTests = parseAcTests(readAtRef(root, mb, f.path) ?? "");
    for (const t of parseAcTests(headText)) {
      const same = baseTests.find((b) => b.title === t.title && b.body === t.body && b.acs.join() === t.acs.join());
      if (!same) targets.push({ file: f.path, ...t });
    }
  }
  const results = [];
  if (targets.length === 0) return { results, targets, mb };

  const wt = mkdtempSync(path.join(tmpdir(), "prove-red-"));
  try {
    git(root, ["worktree", "add", "--detach", "--force", wt, mb], { stdio: "ignore" });
    linkNodeModules(root, wt);
    const files = [...new Set(targets.map((t) => t.file))];
    for (const file of files) {
      mkdirSync(path.dirname(path.join(wt, file)), { recursive: true });
      writeFileSync(path.join(wt, file), readFileSync(path.join(root, file)));
    }
    const out = path.join(wt, ".prove-red.json");
    const vitest = path.join(wt, "node_modules", ".bin", "vitest");
    const run = spawnSync(vitest, ["run", ...files, "--reporter=json", `--outputFile=${out}`, "--passWithNoTests"], {
      cwd: wt,
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 300_000,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });
    const json = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { testResults: [] };
    for (const t of targets) {
      const fileRes = json.testResults.find((r) => r.name.replace(/\\/g, "/").endsWith(`/${t.file}`));
      const label = `${t.file} › ${t.title} (${t.acs.join(", ")})`;
      if (!fileRes || (fileRes.assertionResults.length === 0 && fileRes.status === "failed")) {
        const why = fileRes?.message?.split("\n")[0] || run.stderr?.split("\n").find((l) => l.trim()) || "not collected";
        results.push({ rule: "loads-on-base", ok: false, label, message: `does not load on the merge base (${why})` });
        continue;
      }
      const a = fileRes.assertionResults.find((x) => x.title === t.title);
      if (!a) results.push({ rule: "loads-on-base", ok: false, label, message: "was not collected on the merge base" });
      else if (a.status === "passed")
        results.push({
          rule: "red-on-base",
          ok: false,
          label,
          message: "passes on the merge base, without the feature; it proves nothing",
        });
      else if (a.status !== "failed")
        results.push({
          rule: "red-on-base",
          ok: false,
          label,
          message: `is ${a.status} on the merge base; a skipped test proves nothing`,
        });
      else {
        const first = (a.failureMessages?.[0] ?? "").split("\n")[0];
        if (ASSERTION.test(first))
          results.push({ rule: "right-reason", ok: true, label, message: `red on the merge base: ${first}` });
        else
          results.push({
            rule: "right-reason",
            ok: false,
            label,
            message: `fails on the merge base for the wrong reason: ${first}`,
          });
      }
    }
  } finally {
    tryGit(root, ["worktree", "remove", "--force", wt]);
    rmSync(wt, { recursive: true, force: true });
    tryGit(root, ["worktree", "prune"]);
  }
  return { results, targets, mb };
}

export function runProveRed(root, args, out, env = process.env) {
  const i = args.indexOf("--base");
  const base = i >= 0 ? args[i + 1] : (env.FACTORY_BASE ?? "origin/main");
  const { results, mb } = proveRed(root, { base });
  if (results.length === 0) {
    out.log("prove-red: PASS (no new or changed @ac tests)");
    return 0;
  }
  const bad = results.filter((r) => !r.ok);
  const lines = [
    `prove-red: ${bad.length ? "FAIL" : "PASS"} (${results.length} @ac test(s) run against merge base ${mb.slice(0, 10)})`,
  ];
  for (const r of results) lines.push(`  ${r.ok ? "ok" : "x "} ${r.label}: ${r.message}`);
  if (bad.length)
    lines.push(
      "  fix: an acceptance test must fail without the feature, on an assertion. Assert the new behaviour through a module that exists on the base (not a new import), and remove any branch that lets it pass.",
    );
  (bad.length ? out.err : out.log)(lines.join("\n"));
  return bad.length ? 1 : 0;
}
