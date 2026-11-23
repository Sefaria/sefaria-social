// `npm run factory -- compile NNN [--draft]`: turn an approved spec and its tasks.yaml into workorder.json (plan 5.3).
// Deterministic: no timestamps, stable key order, so the same inputs always give the same bytes.
// `--draft` compiles an unapproved spec into a work order marked `"approved": false`, so agents can build ahead of approval;
// the CI gate rejects such work orders until a human approves the spec and it is recompiled without --draft.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { FactoryError, readJson, readText } from "./lib/repo.mjs";
import { globProblems } from "./lib/glob.mjs";
import { globTouchesProtected } from "./lib/paths.mjs";
import { FEATURES, approvalState, fileHash, loadApprovals, loadFeatures, loadSpec, loadTasks } from "./lib/spec.mjs";

/** Rule ids, one per check; each has a negative test tagged `@guard compile/<id>` (doctor checks). */
export const RULES = [
  "spec-valid",
  "approved",
  "feature-scenarios",
  "ac-tasks",
  "task-fields",
  "globs",
  "verify-commands",
  "no-cycles",
  "protected-paths",
  "atlas-ids",
];

const VERIFY_RUNNERS = /^(npm|npx|node)\s/;

function checkVerify(root, cmd) {
  if (!VERIFY_RUNNERS.test(cmd)) return `'${cmd}' must start with npm, npx or node (verify commands run in CI and locally)`;
  const pkg = readJson(root, "package.json", {});
  const scripts = pkg.scripts ?? {};
  if (cmd.startsWith("npm ")) {
    const builtin = cmd.match(/^npm\s+(test|t|ci|exec)\b/);
    if (builtin) {
      if ((builtin[1] === "test" || builtin[1] === "t") && !scripts.test) return `'${cmd}': package.json has no "test" script`;
      return null;
    }
    const name = cmd.match(/^npm\s+run(?:-script)?\s+(?:-s\s+|--silent\s+)?([\w:.-]+)/)?.[1];
    if (!name) return `'${cmd}' is not 'npm run <script>', 'npm test' or 'npm exec'`;
    if (!scripts[name]) return `'${cmd}': package.json has no "${name}" script`;
  }
  return null;
}

function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "active") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "active");
    stack.push(id);
    for (const dep of byId.get(id)?.depends_on ?? []) {
      const c = visit(dep);
      if (c) return c;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const t of tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}

/**
 * Compile one spec. Returns { workorder, features, problems: [{rule, message}] } without writing anything.
 * @param {string} root @param {string} id @param {{ draft?: boolean }} opts
 */
export function compileSpec(root, id, opts = {}) {
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });
  const spec = loadSpec(root, id);
  for (const p of spec.problems) add("spec-valid", p);

  const approvals = loadApprovals(root);
  for (const p of approvals.problems) add("spec-valid", p);
  const approval = approvalState(approvals.data, spec);
  if (!approval.ok && !opts.draft) add("approved", `spec ${spec.id} not approved: ${approval.reason}`);

  // ACs <-> scenarios
  const acIds = spec.acs.map((a) => a.id);
  if (!spec.feature.sawFeature) add("feature-scenarios", `${spec.featureRel} has no 'Feature:' line`);
  for (const ac of acIds)
    if (!spec.feature.scenarios.some((s) => s.acs.includes(ac)))
      add("feature-scenarios", `${ac} has no scenario in ${spec.featureRel} (tag one with @${ac})`);
  for (const s of spec.feature.scenarios) {
    if (s.acs.length === 0) add("feature-scenarios", `${spec.featureRel}:${s.line} scenario '${s.name}' has no @AC-xxx tag`);
    for (const ac of s.acs)
      if (!acIds.includes(ac))
        add("feature-scenarios", `${spec.featureRel}:${s.line} is tagged @${ac}, but spec.md has no ${ac}`);
  }

  // tasks
  const { rel: tasksRel, tasks: rawTasks, problems: taskSchema } = loadTasks(root, spec.dir);
  for (const p of taskSchema) add("task-fields", p);
  const tasks = Array.isArray(rawTasks) ? rawTasks.filter((t) => t && typeof t === "object") : [];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) add("task-fields", `${tasksRel}: task id ${t.id} is used twice`);
    ids.add(t.id);
    for (const ac of t.acs ?? []) if (!acIds.includes(ac)) add("ac-tasks", `${t.id} names ${ac}, which spec.md does not list`);
    for (const dep of t.depends_on ?? [])
      if (!tasks.some((x) => x.id === dep)) add("no-cycles", `${t.id} depends on unknown task ${dep}`);
    for (const g of t.files ?? []) {
      for (const p of globProblems(g)) add("globs", `${t.id} file glob '${g}' ${p}`);
      if (g.startsWith("specs/")) add("globs", `${t.id} file glob '${g}' is a spec asset; a task never edits its spec`);
      const prot = globTouchesProtected(g);
      if (prot && spec.frontmatter.risk !== "high")
        add(
          "protected-paths",
          `${t.id} file glob '${g}' reaches protected path '${prot}', but spec risk is '${spec.frontmatter.risk}' (needs 'high' and a human owner's review)`,
        );
    }
    for (const v of t.verify ?? []) {
      const msg = checkVerify(root, v);
      if (msg) add("verify-commands", `${t.id} verify ${msg}`);
    }
    for (const f of t.completes ?? [])
      if (!(spec.frontmatter.features ?? []).includes(f))
        add("atlas-ids", `${t.id} completes ${f}, which the spec's features list does not name`);
  }
  for (const ac of acIds)
    if (!tasks.some((t) => (t.acs ?? []).includes(ac))) add("ac-tasks", `${ac} is not covered by any task in ${tasksRel}`);
  const cycle = findCycle(tasks);
  if (cycle) add("no-cycles", `task dependencies form a cycle: ${cycle.join(" -> ")}`);

  // atlas
  const atlas = loadFeatures(root);
  for (const p of atlas.problems) add("atlas-ids", p);
  const features = structuredClone(atlas.data);
  features.features ??= [];
  const approvedAt = approval.ok ? approval.entry.at.slice(0, 10) : null;
  for (const fid of spec.frontmatter.features ?? []) {
    const existing = features.features.find((f) => f.id === fid);
    if (!existing) {
      features.features.push({
        id: fid,
        area: fid.split("-")[0].toLowerCase(),
        name: spec.frontmatter.title,
        description: "",
        status: "planned",
        spec: spec.id,
        acs: (spec.frontmatter.features ?? []).length === 1 ? acIds.map((a) => `${spec.id}/${a}`) : [],
        surfaces: spec.frontmatter.surfaces ?? [],
        depends_on: {},
        tests: [],
        since: null,
        changed: [],
      });
    } else if (existing.spec !== spec.id && !existing.changed.some((c) => c.spec === spec.id)) {
      existing.changed.push({ spec: spec.id, date: approvedAt });
    } else if (existing.spec !== spec.id) {
      const c = existing.changed.find((x) => x.spec === spec.id);
      if (c.date === null && approvedAt) c.date = approvedAt;
    }
  }
  features.features.sort((a, b) => a.id.localeCompare(b.id));

  const tasksText = readText(root, tasksRel) ?? "";
  const workorder = {
    $comment: `Generated by 'npm run factory -- compile ${spec.id}'. Do not edit by hand, except to set an AC's passes/evidence from a green CI run.`,
    spec: spec.id,
    title: spec.frontmatter.title ?? "",
    approved: approval.ok,
    ...(approval.ok ? { approved_by: approval.entry.by } : {}),
    spec_sha: spec.sha,
    feature_sha: spec.featureSha,
    tasks_sha: fileHash(tasksText),
    risk: spec.frontmatter.risk ?? "normal",
    features: spec.frontmatter.features ?? [],
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      acs: t.acs ?? [],
      files: t.files ?? [],
      depends_on: t.depends_on ?? [],
      parallel: t.parallel ?? false,
      verify: t.verify ?? [],
      completes: t.completes ?? [],
    })),
    acs: [],
  };
  // Carry evidence forward only while the agreed content is unchanged; a changed spec resets every AC to unproven.
  const previous = readJson(root, `${spec.dir}/workorder.json`, null);
  workorder.acs = spec.acs.map((a) => {
    const prev = previous?.spec_sha === spec.sha ? previous.acs?.find((x) => x.ac === a.id) : undefined;
    return {
      ac: a.id,
      text: a.text,
      scenarios: spec.feature.scenarios.filter((s) => s.acs.includes(a.id)).map((s) => s.name),
      passes: prev?.passes ?? false,
      evidence: prev?.evidence ?? null,
    };
  });
  return { spec, workorder, features, problems };
}

export function runCompile(root, args, out) {
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) throw new FactoryError("compile needs a spec id", "npm run factory -- compile NNN [--draft]");
  const draft = args.includes("--draft");
  const { spec, workorder, features, problems } = compileSpec(root, id, { draft });
  if (problems.length) {
    out.err(`compile ${spec.id}: FAIL (${problems.length} problem${problems.length > 1 ? "s" : ""})`);
    for (const p of problems) out.err(`  x [${p.rule}] ${p.message}`);
    if (problems.some((p) => p.rule === "approved"))
      out.err(
        `  fix: a human code owner reviews ${spec.dir}/ and runs 'npm run factory -- approve ${spec.id} --by <their email>'. To build ahead of approval: 'npm run factory -- compile ${spec.id} --draft'.`,
      );
    return 1;
  }
  const woRel = `${spec.dir}/workorder.json`;
  writeFileSync(path.join(root, woRel), `${JSON.stringify(workorder, null, 2)}\n`);
  mkdirSync(path.join(root, path.dirname(FEATURES)), { recursive: true });
  writeFileSync(path.join(root, FEATURES), `${JSON.stringify(features, null, 2)}\n`);
  out.log(`compile ${spec.id}: wrote ${woRel} (${workorder.tasks.length} task(s), ${workorder.acs.length} AC(s))`);
  if (!workorder.approved)
    out.log(`  DRAFT: spec ${spec.id} is not approved; the work order is marked "approved": false and spec-gate will refuse it.`);
  return 0;
}
