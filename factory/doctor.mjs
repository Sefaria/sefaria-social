// `npm run factory -- doctor [--skip-tests]`: is the factory itself healthy? (plan 5.9)
// Fails when: a hook is registered but missing, or present but unregistered; a guard has no negative test, or its negative
// test does not pass; a required check named in the docs is not a job; a CI job is not aggregated by `result`; a skill's or
// agent's frontmatter is invalid, or a SKILL.md contains `$` followed by a digit; a protected path has no code owner;
// CLAUDE.md is over 150 lines; a relative docs link is broken; the pinned contract's hash differs from its recorded hash;
// an agent job is uncapped, ungated or holds a credential it must not (F2); a workflow job has no time limit, an unknown
// `needs`, or an unpinned third-party action; a surface used by a spec or the atlas is missing from factory/surface-map.yaml.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { readText, walk } from "./lib/repo.mjs";
import { matchGlob } from "./lib/glob.mjs";
import { APPROVALS_FILE, PROTECTED, SPECS } from "./lib/paths.mjs";
import { RULES as COMPILE } from "./compile.mjs";
import { RULES as APPROVE } from "./approve.mjs";
import { RULES as GATE } from "./gate.mjs";
import { RULES as ATLAS } from "./atlas.mjs";
import { RULES as PROVE_RED } from "./prove-red.mjs";
import { RULES as PREFLIGHT } from "./preflight.mjs";
import { RULES as METRICS } from "./metrics.mjs";
import { RULES as SURFACES, loadSurfaceMap } from "./surfaces.mjs";
import { RULES as QA } from "./qa.mjs";
import { RULES as TEST_HEALTH } from "./test-health.mjs";
import { RULES as RETRO } from "./retro.mjs";
import { RULES as QUALITY } from "./quality-score.mjs";
import { RULES as HOLDOUT } from "./holdout.mjs";
import { listSpecs, loadFeatures, loadSpec } from "./lib/spec.mjs";
import { RULES as GUARD_PATHS } from "../.claude/hooks/guard-paths.mjs";
import { RULES as STOP_VERIFY } from "../.claude/hooks/stop-verify.mjs";

export const RULES = [
  "hooks-registered",
  "guard-tests",
  "required-checks",
  "result-needs",
  "skills",
  "agents",
  "codeowners",
  "claude-md-lines",
  "doc-links",
  "pinned-contract",
  "agent-jobs",
  "workflows",
  "surface-map",
];

export const CLAUDE_MD_MAX = 150;
const FACTORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every guard the factory ships, as "<module>/<rule>". Each needs a test tagged `@guard <id>` that injects the fault. */
export function allGuards() {
  const ns = (prefix, rules) => rules.map((r) => `${prefix}/${r}`);
  return [
    ...ns("compile", COMPILE),
    ...ns("approve", APPROVE),
    ...ns("gate", GATE),
    ...ns("atlas", ATLAS),
    ...ns("prove-red", PROVE_RED),
    ...ns("preflight", PREFLIGHT),
    ...ns("metrics", METRICS),
    ...ns("surfaces", SURFACES),
    ...ns("qa", QA),
    ...ns("test-health", TEST_HEALTH),
    ...ns("retro", RETRO),
    ...ns("quality-score", QUALITY),
    ...ns("holdout", HOLDOUT),
    ...ns("doctor", RULES),
    ...ns("hook/guard-paths", GUARD_PATHS),
    ...ns("hook/stop-verify", STOP_VERIFY),
  ];
}

const frontmatter = (text) => {
  const m = text?.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    return YAML.parse(m[1]) ?? {};
  } catch {
    return undefined;
  }
};

export function checkHooks(root) {
  const problems = [];
  const settingsText = readText(root, ".claude/settings.json");
  if (settingsText === null) return [".claude/settings.json is missing (hooks are registered there)"];
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch (e) {
    return [`.claude/settings.json is not valid JSON: ${e.message}`];
  }
  const referenced = new Set();
  for (const groups of Object.values(settings.hooks ?? {}))
    for (const g of groups ?? [])
      for (const h of g.hooks ?? []) {
        const cmd = [h.command, ...(h.args ?? [])].join(" ");
        for (const m of cmd.matchAll(/\.claude\/hooks\/([\w.-]+\.mjs)/g)) referenced.add(m[1]);
      }
  const dir = path.join(root, ".claude/hooks");
  const present = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mjs")) : [];
  for (const r of referenced)
    if (!present.includes(r)) problems.push(`hook .claude/hooks/${r} is registered in .claude/settings.json but missing`);
  for (const p of present)
    if (!referenced.has(p)) problems.push(`hook .claude/hooks/${p} exists but is not registered in .claude/settings.json`);
  return problems;
}

export function guardTags(root) {
  const tags = new Map();
  for (const file of [...walk(root, "factory"), ...walk(root, "test")].filter((f) => /\.test\.(mjs|ts)$/.test(f))) {
    const text = readText(root, file) ?? "";
    for (const m of text.matchAll(/^\s*\/\/\s*@guard\s+([\w/-]+)\s*$/gm)) {
      if (!tags.has(m[1])) tags.set(m[1], []);
      tags.get(m[1]).push(file);
    }
  }
  return tags;
}

export function checkGuardTests(root, guards = allGuards()) {
  const tags = guardTags(root);
  return guards
    .filter((g) => !tags.has(g))
    .map((g) => `guard '${g}' has no negative test (tag one with '@guard ${g}' in factory/test/)`);
}

function workflows(root) {
  const dir = path.join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const rel = `.github/workflows/${f}`;
      try {
        return { rel, data: YAML.parse(readText(root, rel)) ?? {} };
      } catch (e) {
        return { rel, data: {}, error: e.message };
      }
    });
}

export function checkRequiredChecks(root) {
  const problems = [];
  const wfs = workflows(root);
  const jobNames = new Set();
  for (const w of wfs) {
    if (w.error) problems.push(`${w.rel} is not valid YAML: ${w.error}`);
    for (const [key, job] of Object.entries(w.data.jobs ?? {})) jobNames.add(job?.name ?? key);
  }
  const named = new Map();
  const docs = [...walk(root, "docs").filter((f) => f.endsWith(".md")), "CLAUDE.md"].filter((f) => f !== "docs/PLAN.md");
  for (const file of docs) {
    const text = readText(root, file);
    if (!text) continue;
    let inSection = false;
    for (const line of text.split("\n")) {
      if (/^#{1,6}\s/.test(line)) inSection = /^#{1,6}\s+required checks?\b/i.test(line);
      const phrase = [...line.matchAll(/required (?:status )?checks? (?:is|are) ((?:`[a-z0-9-]+`(?:,? (?:and )?)?)+)/gi)].flatMap(
        (m) => [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]),
      );
      const fromSection =
        inSection && /^\s*[-*|]/.test(line) ? [...line.matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]).slice(0, 1) : [];
      for (const n of [...phrase, ...fromSection]) if (!named.has(n)) named.set(n, file);
    }
  }
  for (const [n, file] of named)
    if (!jobNames.has(n)) problems.push(`required check '${n}' (named in ${file}) is not a job in .github/workflows/`);
  return problems;
}

export function checkResultNeeds(root) {
  const problems = [];
  const ci = workflows(root).find((w) => w.rel.endsWith("/ci.yml"));
  if (!ci) return [".github/workflows/ci.yml is missing"];
  const jobs = ci.data.jobs ?? {};
  if (!jobs.result) return ["ci.yml has no `result` job (the one required check)"];
  const needs = new Set([].concat(jobs.result.needs ?? []));
  // A reporter job that needs `result` (it runs after it, e.g. `metrics`) cannot be in result.needs; it never blocks a merge.
  const reporter = (key) => [].concat(jobs[key]?.needs ?? []).includes("result");
  for (const key of Object.keys(jobs))
    if (key !== "result" && !needs.has(key) && !reporter(key))
      problems.push(`ci.yml job '${key}' is not in result.needs, so its failure would not block a merge`);
  for (const n of needs) if (!jobs[n]) problems.push(`result.needs names '${n}', which is not a job in ci.yml`);
  for (const n of needs)
    if (!new RegExp(`needs\\.${n.replace(/-/g, "\\-")}\\.result`).test(JSON.stringify(jobs.result)))
      problems.push(`result's script does not read needs.${n}.result`);
  return problems;
}

export function checkSkills(root) {
  const problems = [];
  const dir = path.join(root, ".claude/skills");
  if (!existsSync(dir)) return problems;
  for (const name of readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const text = readText(root, rel);
    if (text === null) {
      problems.push(`${rel} is missing`);
      continue;
    }
    const fm = frontmatter(text);
    if (!fm) {
      problems.push(`${rel} has no valid YAML frontmatter`);
      continue;
    }
    if (fm.name !== name) problems.push(`${rel} frontmatter name '${fm.name}' must equal the folder name '${name}'`);
    if (!/^[a-z0-9-]{1,64}$/.test(String(fm.name ?? "")))
      problems.push(`${rel} name must be lowercase letters, digits and hyphens (max 64)`);
    const d = String(fm.description ?? "");
    if (!d) problems.push(`${rel} has no description`);
    else {
      if (d.length > 1024) problems.push(`${rel} description is over 1024 characters`);
      if (!/\buse (it |this )?when\b/i.test(d)) problems.push(`${rel} description must say when to use it ("Use when …")`);
      if (!/\b(do not|don't|not for|never)\b/i.test(d))
        problems.push(`${rel} description must say when not to use it ("Do not use …")`);
    }
    text.split("\n").forEach((line, i) => {
      if (/\$\d/.test(line))
        problems.push(
          `${rel}:${i + 1} contains '$' followed by a digit, which skill arguments replace; move the snippet to a script`,
        );
    });
  }
  return problems;
}

const READ_ONLY_AGENTS = { reviewer: ["Read", "Grep", "Glob"], skeptic: ["Read", "Grep", "Glob"] };

export function checkAgents(root) {
  const problems = [];
  const dir = path.join(root, ".claude/agents");
  if (!existsSync(dir)) return problems;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const rel = `.claude/agents/${file}`;
    const fm = frontmatter(readText(root, rel));
    const name = file.replace(/\.md$/, "");
    if (!fm) {
      problems.push(`${rel} has no valid YAML frontmatter`);
      continue;
    }
    if (fm.name !== name) problems.push(`${rel} name '${fm.name}' must equal the file name '${name}'`);
    if (!fm.description) problems.push(`${rel} has no description`);
    if (!fm.tools) problems.push(`${rel} must list its tools (least privilege)`);
    const allowed = READ_ONLY_AGENTS[name];
    if (allowed && fm.tools) {
      const tools = String(fm.tools)
        .split(/[\s,]+/)
        .filter(Boolean);
      const extra = tools.filter((t) => !allowed.includes(t));
      if (extra.length) problems.push(`${rel} may use only ${allowed.join(", ")}; it lists ${extra.join(", ")}`);
    }
  }
  return problems;
}

function codeownersRules(text) {
  return (text ?? "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const [pattern, ...owners] = l.split(/\s+/);
      let g = pattern.replace(/^\//, "");
      const anchored = pattern.startsWith("/") || pattern.replace(/\/$/, "").includes("/");
      if (g.endsWith("/")) g += "**";
      else if (!/[*?]/.test(g.split("/").pop())) g = `{${g},${g}/**}`;
      if (!anchored) g = `**/${g}`;
      return { pattern, glob: g, owners };
    });
}

export function checkCodeowners(root) {
  const text = readText(root, ".github/CODEOWNERS");
  if (text === null) return [".github/CODEOWNERS is missing"];
  const rules = codeownersRules(text);
  const problems = [];
  for (const p of [...PROTECTED, ...SPECS, APPROVALS_FILE]) {
    const probe = p.endsWith("/**") ? `${p.slice(0, -3)}/probe/file.ts` : p;
    const last = rules.filter((r) => matchGlob(r.glob, probe)).pop();
    if (!last || last.owners.length === 0 || !last.owners.every((o) => /^@[\w.-]+(\/[\w.-]+)?$|^[^@\s]+@[^@\s]+$/.test(o)))
      problems.push(`protected path '${p}' has no code owner in .github/CODEOWNERS`);
  }
  return problems;
}

export function checkClaudeMd(root) {
  const text = readText(root, "CLAUDE.md");
  if (text === null) return ["CLAUDE.md is missing"];
  const n = text.replace(/\n$/, "").split("\n").length;
  return n > CLAUDE_MD_MAX ? [`CLAUDE.md has ${n} lines (limit ${CLAUDE_MD_MAX}); move procedures into skills`] : [];
}

export function checkDocLinks(root) {
  const problems = [];
  const files = walk(root).filter((f) => f.endsWith(".md") && !f.startsWith("node_modules/"));
  for (const file of files) {
    const text = readText(root, file) ?? "";
    let fenced = false;
    text.split("\n").forEach((line, i) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) return;
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^([a-z]+:|#|\/\/)/i.test(target) || target.startsWith("<")) continue;
        const clean = decodeURIComponent(target.split("#")[0].split("?")[0]);
        if (!clean) continue;
        const resolved = path.normalize(path.join(path.dirname(file), clean));
        if (resolved.startsWith("..") || !existsSync(path.join(root, resolved)))
          problems.push(`${file}:${i + 1} links to '${target}', which does not exist`);
      }
    });
  }
  return problems;
}

export function checkPinnedContract(root) {
  const dir = "packages/host-contract/pinned";
  if (!existsSync(path.join(root, dir))) return [];
  const recorded = (readText(root, `${dir}/contract.sha256`) ?? "").trim();
  const h = createHash("sha256");
  for (const f of walk(root, dir).filter((f) => !f.endsWith("contract.sha256")))
    h.update(`${f.slice(dir.length + 1)}\0`)
      .update(readText(root, f) ?? "")
      .update("\0");
  const actual = `sha256:${h.digest("hex")}`;
  if (!recorded) return [`${dir}/contract.sha256 is missing; the pinned contract must record its hash (contract-sync writes it)`];
  return recorded === actual
    ? []
    : [
        `pinned contract hash ${actual} differs from the recorded ${recorded}; re-run the contract-sync skill instead of editing pinned files`,
      ];
}

const AGENT_ACTION = /^anthropics\/claude-code-action@/;
const SECURITY_ACTION = /^anthropics\/claude-code-security-review@/;
/** Secrets an agent job may read. Deploy credentials and the holdout key are never among them (plan 5.8). */
export const AGENT_SECRETS = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"];
/** The only workflows that may read the holdout deploy key (plan 5.5 L5b). */
export const HOLDOUT_WORKFLOWS = [".github/workflows/nightly.yml", ".github/workflows/release.yml"];

const secretsIn = (obj) => [...new Set([...JSON.stringify(obj ?? {}).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];

/**
 * Every job that runs an agent action: an explicit timeout, gated on a preflight job's `run` output (so it skips with a notice
 * when credentials are absent), capped turns, an explicit model, a minimal tool list, forks refused, the action pinned to a
 * commit, and no secret beyond the Anthropic key and the workflow token.
 */
export function checkAgentJobs(root) {
  const problems = [];
  for (const w of workflows(root)) {
    const jobs = w.data.jobs ?? {};
    for (const [key, job] of Object.entries(jobs)) {
      const steps = job?.steps ?? [];
      const agentSteps = steps.filter((s) => AGENT_ACTION.test(s?.uses ?? "") || SECURITY_ACTION.test(s?.uses ?? ""));
      if (!agentSteps.length) continue;
      const at = `${w.rel} job '${key}'`;
      if (typeof job["timeout-minutes"] !== "number") problems.push(`${at} runs an agent without timeout-minutes`);
      const needs = [].concat(job.needs ?? []);
      const gate = needs.find((n) => {
        const pre = jobs[n];
        const runsPreflight = JSON.stringify(pre?.steps ?? []).includes("factory/preflight.mjs");
        return runsPreflight && new RegExp(`needs\\.${n}\\.outputs\\.run\\s*==\\s*'true'`).test(String(job.if ?? ""));
      });
      if (!gate)
        problems.push(
          `${at} is not gated on a preflight job (needs: <job running factory/preflight.mjs>, if: needs.<job>.outputs.run == 'true'), so it would fail instead of skipping when credentials are absent`,
        );
      for (const s of agentSteps) {
        if (!/@[0-9a-f]{40}$/.test(s.uses)) problems.push(`${at} uses ${s.uses}; pin agent actions to a full commit SHA`);
        const w2 = s.with ?? {};
        if (AGENT_ACTION.test(s.uses)) {
          const args = String(w2.claude_args ?? "");
          if (!/--max-turns\s+\d+/.test(args)) problems.push(`${at} has no --max-turns in claude_args`);
          if (!/--model\s+\S+/.test(args)) problems.push(`${at} has no --model in claude_args`);
          if (!/--allowedTools\s+\S+/.test(args)) problems.push(`${at} has no --allowedTools in claude_args`);
          if (/Bash\(\*\)|--dangerously-skip-permissions|bypassPermissions/.test(args))
            problems.push(`${at} allows every command; list the exact tools it needs`);
          if (String(w2.allow_fork_prs) !== "false") problems.push(`${at} must set allow_fork_prs: "false"`);
          if (!String(w2.prompt ?? "").trim()) problems.push(`${at} has no explicit prompt`);
        } else {
          if (!w2["claudecode-timeout"]) problems.push(`${at} must set claudecode-timeout for the security review`);
          if (!/head\.repo\.full_name\s*==\s*github\.repository/.test(String(job.if ?? "")))
            problems.push(
              `${at} must refuse forks in its if: (github.event.pull_request.head.repo.full_name == github.repository)`,
            );
        }
      }
      const allowed = [...AGENT_SECRETS, ...(HOLDOUT_WORKFLOWS.includes(w.rel) ? ["HOLDOUT_DEPLOY_KEY"] : [])];
      const extra = secretsIn(job).filter((x) => !allowed.includes(x));
      if (extra.length) problems.push(`${at} reads secret(s) ${extra.join(", ")}; agent jobs get only ${allowed.join(", ")}`);
    }
  }
  return problems;
}

/** Workflow hygiene the factory relies on: time limits, valid needs, pinned third-party actions, the holdout key's scope. */
export function checkWorkflows(root) {
  const problems = [];
  for (const w of workflows(root)) {
    if (w.error) continue; // reported by required-checks
    if (!w.data.on) problems.push(`${w.rel} has no 'on' trigger`);
    if (!w.data.permissions) problems.push(`${w.rel} has no top-level 'permissions' (default to contents: read)`);
    const jobs = w.data.jobs ?? {};
    for (const [key, job] of Object.entries(jobs)) {
      const at = `${w.rel} job '${key}'`;
      if (!job?.uses && typeof job?.["timeout-minutes"] !== "number") problems.push(`${at} has no timeout-minutes`);
      for (const n of [].concat(job?.needs ?? [])) if (!jobs[n]) problems.push(`${at} needs '${n}', which is not a job here`);
      for (const s of job?.steps ?? []) {
        const u = String(s?.uses ?? "");
        if (!u || u.startsWith("./") || u.startsWith("docker://") || /^actions\//.test(u)) continue;
        if (!/@[0-9a-f]{40}$/.test(u)) problems.push(`${at} uses ${u}; pin third-party actions to a full commit SHA`);
      }
      if (secretsIn(job).includes("HOLDOUT_DEPLOY_KEY") && !HOLDOUT_WORKFLOWS.includes(w.rel))
        problems.push(
          `${at} reads HOLDOUT_DEPLOY_KEY; only ${HOLDOUT_WORKFLOWS.join(" and ")} may check out the holdout repository`,
        );
    }
  }
  return problems;
}

/** Every surface named by a spec or an atlas entry exists in factory/surface-map.yaml, and the map is well formed. */
export function checkSurfaceMap(root) {
  if (readText(root, "factory/surface-map.yaml") === null) return ["factory/surface-map.yaml is missing"];
  let map;
  try {
    map = loadSurfaceMap(root);
  } catch (e) {
    return [e.message];
  }
  const problems = map.problems.map((p) => `factory/surface-map.yaml: ${p}`);
  const known = new Set(Object.keys(map.surfaces));
  for (const s of listSpecs(root)) {
    let spec;
    try {
      spec = loadSpec(root, s.id);
    } catch {
      continue; // spec problems are the compiler's and the gate's job
    }
    for (const k of spec.frontmatter?.surfaces ?? [])
      if (!known.has(k)) problems.push(`spec ${s.id} names surface '${k}', which is not in factory/surface-map.yaml`);
  }
  for (const f of loadFeatures(root).data.features ?? [])
    for (const k of f.surfaces ?? [])
      if (!known.has(k)) problems.push(`atlas entry ${f.id} names surface '${k}', which is not in factory/surface-map.yaml`);
  return problems;
}

export function runChecks(root) {
  return [
    ["hooks-registered", checkHooks(root)],
    ["guard-tests", checkGuardTests(root)],
    ["required-checks", checkRequiredChecks(root)],
    ["result-needs", checkResultNeeds(root)],
    ["skills", checkSkills(root)],
    ["agents", checkAgents(root)],
    ["codeowners", checkCodeowners(root)],
    ["claude-md-lines", checkClaudeMd(root)],
    ["doc-links", checkDocLinks(root)],
    ["pinned-contract", checkPinnedContract(root)],
    ["agent-jobs", checkAgentJobs(root)],
    ["workflows", checkWorkflows(root)],
    ["surface-map", checkSurfaceMap(root)],
  ];
}

/** Run the guards' negative tests: they must pass (each asserts that its guard turns red on the injected fault). */
export function runGuardTests(root) {
  const files = [...new Set([...guardTags(root).values()].flat())];
  if (files.length === 0) return ["no guard tests found"];
  const vitest = path.join(FACTORY_ROOT, "node_modules", ".bin", "vitest");
  const r = spawnSync(vitest, ["run", ...files, "--reporter=dot"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  if (r.status === 0) return [];
  const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
  return [`guard negative tests failed (a guard did not turn red when its fault was injected):\n${tail}`];
}

export function runDoctor(root, args, out) {
  const results = runChecks(root);
  if (!args.includes("--skip-tests")) results.push(["guard-tests (run)", runGuardTests(root)]);
  const bad = results.filter(([, p]) => p.length);
  for (const [name, p] of results) {
    if (p.length) for (const x of p) out.err(`  x [${name}] ${x}`);
    else out.log(`  ok ${name}`);
  }
  (bad.length ? out.err : out.log)(
    `doctor: ${bad.length ? "FAIL" : "PASS"} (${results.length} checks${args.includes("--skip-tests") ? "; guard tests not run here, CI runs them in the factory project" : ""})`,
  );
  return bad.length ? 1 : 0;
}
