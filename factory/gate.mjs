// `npm run factory -- gate --base <ref> [--head <ref>]`: the CI spec gate (plan 5.4). "No spec, no code."
// Reads the PR's changed files (merge-base...head) and commit trailers (base..head) from git, so it runs the same in CI, in a
// terminal and in fixture repos. Every failure names the missing piece and the command that fixes it.
import { appendFileSync } from "node:fs";
import { FactoryError, changedFiles, mergeBase, readAtRef, readJson, readText, resolveRef, trailers } from "./lib/repo.mjs";
import { matchAny } from "./lib/glob.mjs";
import { isDependencyFile, isHousekeeping, isProduct, isProtected, isSpec } from "./lib/paths.mjs";
import {
  APPROVALS,
  CHANGELOG,
  FEATURES,
  NON_HUMAN_EMAIL,
  approvalState,
  contentHash,
  fileHash,
  findSpecDir,
  loadApprovals,
  loadFeatures,
  loadSpec,
  normalizeId,
  schemaProblems,
} from "./lib/spec.mjs";

/** Rule ids; each has a negative test tagged `@guard gate/<id>` in factory/test/gate.test.mjs (doctor checks). */
export const RULES = [
  "housekeeping",
  "trivial-lane",
  "spec-pr",
  "trailers",
  "spec-exists",
  "workorder",
  "approved",
  "task-exists",
  "task-globs",
  "spec-and-code",
  "atlas",
];

export const TRIVIAL_MAX_LINES = 30;

const SPEC_ASSETS = /^specs\/(\d{3})-[^/]+\/(spec\.md|acceptance\.feature)$/;

/**
 * Evaluate the gate. Returns { lane, failures: [{rule, message, why?, fix}], notices: [string], files }.
 * @param {string} root @param {{ base: string, head?: string }} opts
 */
export function evaluateGate(root, opts) {
  const failures = [];
  const notices = [];
  const fail = (rule, message, fix, why) => failures.push({ rule, message, fix, why });
  const baseSha = resolveRef(root, opts.base);
  const headSha = resolveRef(root, opts.head ?? "HEAD");
  const mb = mergeBase(root, baseSha, headSha);
  const files = changedFiles(root, baseSha, headSha);
  const result = (lane) => ({ lane, failures, notices, files });
  if (files.length === 0) return result("empty");

  const nonHousekeeping = files.filter((f) => !isHousekeeping(f.path));
  if (nonHousekeeping.length === 0) {
    notices.push(`housekeeping only (${files.length} file(s): docs, READMEs, snapshots, ignore files); no spec needed`);
    return result("housekeeping");
  }

  const governed = nonHousekeeping.filter((f) => !isSpec(f.path));
  const specFiles = nonHousekeeping.filter((f) => isSpec(f.path));

  // A spec PR: spec assets (plus housekeeping) only. Agreement comes from the code owner's review; check the files are valid.
  if (governed.length === 0) {
    const ids = new Set(specFiles.map((f) => f.path.match(/^specs\/(\d{3})-/)?.[1]).filter(Boolean));
    for (const id of ids) {
      try {
        const spec = loadSpec(root, id);
        for (const p of spec.problems)
          fail("spec-pr", `spec ${id} is not valid: ${p}`, `Fix ${spec.specRel}; see specs/README.md.`);
      } catch (e) {
        if (!(e instanceof FactoryError)) throw e;
        if (!/does not exist/.test(e.message)) fail("spec-pr", e.message, e.fix ?? "Fix the spec files.");
      }
    }
    if (specFiles.some((f) => f.path === APPROVALS)) {
      const { data, problems } = loadApprovals(root);
      for (const p of problems)
        fail("spec-pr", `${APPROVALS} is not valid: ${p}`, "Only 'npm run factory -- approve' writes it.");
      for (const [id, entry] of Object.entries(data))
        if (NON_HUMAN_EMAIL.test(entry.by ?? ""))
          fail(
            "spec-pr",
            `spec ${id} approval is by '${entry.by}', a bot or agent identity`,
            "A human code owner re-runs 'npm run factory -- approve'.",
          );
    }
    notices.push(
      `spec PR (${[...ids].join(", ") || "specs/"}): a human code owner must approve it in review (CODEOWNERS), then run 'npm run factory -- approve NNN --by <email>'`,
    );
    return result("spec");
  }

  // Trivial lane: computed, never self-declared.
  const lines = nonHousekeeping.reduce((n, f) => n + f.added + f.deleted, 0);
  const why = [];
  if (lines > TRIVIAL_MAX_LINES) why.push(`${lines} changed lines (> ${TRIVIAL_MAX_LINES})`);
  const added = nonHousekeeping.filter((f) => f.status === "A" || f.status === "C");
  if (added.length) why.push(`new file(s): ${added.map((f) => f.path).join(", ")}`);
  const prot = nonHousekeeping.filter((f) => isProtected(f.path));
  if (prot.length) why.push(`protected path(s): ${prot.map((f) => f.path).join(", ")}`);
  const deps = nonHousekeeping.filter((f) => isDependencyFile(f.path));
  if (deps.length) why.push(`dependency change: ${deps.map((f) => f.path).join(", ")}`);
  if (specFiles.length) why.push(`spec files changed: ${specFiles.map((f) => f.path).join(", ")}`);
  if (why.length === 0) {
    notices.push(
      `trivial lane: ${lines} changed line(s), no new files, no protected paths, no dependency change; no spec needed`,
    );
    return result("trivial");
  }

  // Full lane: a spec, an approved work order, and every changed file inside a named task.
  const notTrivial = `Not trivial because: ${why.join("; ")}.`;
  const tr = trailers(root, baseSha, headSha);
  const specIds = [
    ...new Set(
      tr
        .filter((t) => t.key.toLowerCase() === "spec")
        .flatMap((t) => t.value.split(/[\s,]+/))
        .filter(Boolean),
    ),
  ];
  const taskRefs = [
    ...new Set(
      tr
        .filter((t) => t.key.toLowerCase() === "task")
        .flatMap((t) => t.value.split(/[\s,]+/))
        .filter(Boolean),
    ),
  ];
  if (specIds.length === 0) {
    fail(
      "trailers",
      "no 'Spec:' trailer on any commit in this PR",
      "Build from a work order: run /build-task (it adds 'Spec: NNN' and 'Task: T-xxx' trailers), or add them: git commit --amend --trailer 'Spec: NNN' --trailer 'Task: T-001'. No spec yet? Shape one with /shape-spec.",
      notTrivial,
    );
    return result("full");
  }
  if (taskRefs.length === 0)
    fail(
      "trailers",
      "no 'Task:' trailer on any commit in this PR",
      "Add the task: git commit --amend --trailer 'Task: T-001' (one per task built).",
      notTrivial,
    );

  const approvals = loadApprovals(root);
  const specs = new Map();
  for (const raw of specIds) {
    let id;
    try {
      id = normalizeId(raw);
      const spec = loadSpec(root, id);
      specs.set(id, spec);
    } catch (e) {
      if (!(e instanceof FactoryError)) throw e;
      fail("spec-exists", `Spec: ${raw} — ${e.message}`, e.fix ?? "Shape the spec with /shape-spec.");
      continue;
    }
    const spec = specs.get(id);
    const woRel = `${spec.dir}/workorder.json`;
    let wo;
    try {
      wo = readJson(root, woRel, null);
    } catch (e) {
      fail("workorder", e.message, `Recompile: npm run factory -- compile ${id}`);
      continue;
    }
    if (!wo) {
      fail(
        "workorder",
        `spec ${id} has no work order (${woRel})`,
        `Plan and compile it: /plan-spec ${id}, then npm run factory -- compile ${id}`,
      );
      continue;
    }
    const woProblems = schemaProblems("workorder", wo);
    if (woProblems.length)
      fail("workorder", `${woRel} is not valid: ${woProblems.join("; ")}`, `Recompile: npm run factory -- compile ${id}`);
    spec.workorder = wo;
    const approval = approvalState(approvals.data, spec);
    if (!approval.ok) {
      fail(
        "approved",
        `spec ${id} not approved`,
        `A human code owner reviews ${spec.dir}/ in this PR, then runs 'npm run factory -- approve ${id} --by <their email>' and 'npm run factory -- compile ${id}', and commits ${APPROVALS} and ${woRel}.`,
        `${approval.reason}${wo.approved === false ? "; the work order was compiled with --draft" : ""}.`,
      );
    } else if (NON_HUMAN_EMAIL.test(approval.entry.by)) {
      fail(
        "approved",
        `spec ${id} approval is by '${approval.entry.by}', a bot or agent identity`,
        `A human code owner runs 'npm run factory -- approve ${id} --by <their email>'.`,
      );
    } else if (wo.approved !== true) {
      fail(
        "workorder",
        `spec ${id} is approved but ${woRel} is still a draft`,
        `Recompile without --draft: npm run factory -- compile ${id}`,
      );
    }
    if (wo.spec_sha !== spec.sha || wo.feature_sha !== spec.featureSha)
      fail(
        "workorder",
        `${woRel} is stale: spec.md or acceptance.feature changed after it was compiled`,
        `Recompile: npm run factory -- compile ${id}`,
      );
    else {
      const tasksText = readText(root, `${spec.dir}/tasks.yaml`);
      if (tasksText !== null && wo.tasks_sha !== fileHash(tasksText))
        fail(
          "workorder",
          `${woRel} is stale: tasks.yaml changed after it was compiled`,
          `Recompile: npm run factory -- compile ${id}`,
        );
    }
  }

  // Named tasks.
  const tasks = [];
  for (const ref of taskRefs) {
    const m = ref.match(/^(?:(\d{1,3})\/)?(T-\d{3})$/);
    const candidates = [...specs.values()].filter((s) => s.workorder && (!m?.[1] || s.id === normalizeId(m[1])));
    const found = m
      ? candidates.flatMap((s) => s.workorder.tasks.filter((t) => t.id === m[2]).map((t) => ({ spec: s, task: t })))
      : [];
    if (found.length === 0) {
      if (specs.size && [...specs.values()].every((s) => s.workorder))
        fail(
          "task-exists",
          `Task: ${ref} is not a task of spec ${[...specs.keys()].join(", ")}`,
          "Use a task id from the work order (Task: T-001, or Task: NNN/T-001 when several specs are named).",
        );
    } else if (found.length > 1) {
      fail("task-exists", `Task: ${ref} is ambiguous (several named specs have it)`, "Write it as Task: NNN/T-001.");
    } else tasks.push(found[0]);
  }

  // Coverage: every changed governed file matches a glob of a named task.
  const bootstrap = readAtRef(root, mb, "factory/gate.mjs") === null;
  const uncovered = [];
  let exempt = 0;
  for (const f of governed) {
    if (bootstrap && !isProduct(f.path)) {
      exempt++;
      continue;
    }
    if (!tasks.some(({ task }) => matchAny(task.files, f.path) || (f.oldPath && matchAny(task.files, f.oldPath))))
      uncovered.push(f.path);
  }
  if (exempt)
    notices.push(
      `bootstrap: the base has no factory/gate.mjs, so this PR introduces the factory; ${exempt} non-product file(s) are exempt from task coverage this once`,
    );
  if (uncovered.length && tasks.length)
    fail(
      "task-globs",
      `${uncovered.length} changed file(s) are outside the named task(s) ${tasks.map((t) => `${t.spec.id}/${t.task.id}`).join(", ")}: ${uncovered.join(", ")}`,
      "Move these changes to their own PR, or add the files to the task's 'files' in tasks.yaml, recompile, and let a human code owner review the change.",
    );

  // A change to an agreed spec is agreed first, in its own PR.
  const productChanged = governed.some((f) => isProduct(f.path));
  if (productChanged) {
    const baseApprovals = parseJsonSafe(readAtRef(root, mb, APPROVALS)) ?? {};
    for (const id of new Set(specFiles.map((f) => f.path.match(SPEC_ASSETS)?.[1]).filter(Boolean))) {
      let dir;
      try {
        dir = findSpecDir(root, id);
      } catch {
        dir = specFiles
          .find((f) => f.path.startsWith(`specs/${id}-`))
          .path.split("/")
          .slice(0, 2)
          .join("/");
      }
      const baseSpec = readAtRef(root, mb, `${dir}/spec.md`);
      const baseFeature = readAtRef(root, mb, `${dir}/acceptance.feature`);
      if (baseSpec === null || baseFeature === null) continue; // a new spec arriving with its first build
      const agreedOnBase = baseApprovals[id]?.sha === contentHash(baseSpec, baseFeature);
      if (agreedOnBase)
        fail(
          "spec-and-code",
          `this PR changes the agreed spec ${id} (${dir}) and product code together`,
          `Split it: put the spec change in its own PR for a human code owner's review and re-approval, then rebuild against the recompiled work order.`,
        );
    }
  }

  // Atlas: a task that completes a feature updates its entry in the same PR.
  const completes = [...new Set(tasks.flatMap(({ task }) => task.completes ?? []))];
  if (completes.length) {
    const changed = new Set(files.map((f) => f.path));
    if (!changed.has(FEATURES))
      fail(
        "atlas",
        `task(s) complete ${completes.join(", ")} but ${FEATURES} is not updated in this PR`,
        `Set each entry's status to 'built', list its tagged tests, and add a line to ${CHANGELOG}.`,
      );
    else {
      const atlas = loadFeatures(root).data.features ?? [];
      for (const id of completes) {
        const e = atlas.find((x) => x.id === id);
        if (!e)
          fail(
            "atlas",
            `${id} is missing from ${FEATURES}`,
            `Recompile the spec (it creates planned entries), then mark it built.`,
          );
        else if (!["built", "verified"].includes(e.status) || e.tests.length === 0)
          fail(
            "atlas",
            `${id} is completed by this PR but its atlas entry is '${e.status}' with ${e.tests.length} test(s)`,
            `Set status 'built' and list the tests tagged '@feature ${id}' in ${FEATURES}.`,
          );
      }
      if (!changed.has(CHANGELOG))
        fail("atlas", `${CHANGELOG} has no line for ${completes.join(", ")}`, `Add one line per feature built to ${CHANGELOG}.`);
    }
  }
  return result("full");
}

function parseJsonSafe(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function formatGate(res) {
  const out = [];
  out.push(`spec-gate: ${res.failures.length ? "FAIL" : "PASS"} (lane: ${res.lane}, ${res.files.length} changed file(s))`);
  for (const f of res.failures) {
    out.push(`  x ${f.message}`);
    if (f.why) out.push(`    why: ${f.why}`);
    out.push(`    fix: ${f.fix}`);
  }
  for (const n of res.notices) out.push(`  notice: ${n}`);
  return out.join("\n");
}

export function runGate(root, args, out, env = process.env) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const base = get("--base") ?? env.FACTORY_BASE ?? "origin/main";
  const head = get("--head") ?? "HEAD";
  const res = evaluateGate(root, { base, head });
  const text = formatGate(res);
  (res.failures.length ? out.err : out.log)(text);
  if (env.GITHUB_ACTIONS === "true") {
    for (const f of res.failures) out.log(`::error title=spec-gate::${f.message}. Fix: ${f.fix}`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text}\n\`\`\`\n`);
  }
  return res.failures.length ? 1 : 0;
}
