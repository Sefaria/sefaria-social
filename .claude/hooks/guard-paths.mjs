#!/usr/bin/env node
// PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit (plan 5.4): "no spec, no code", locally.
// - Blocks edits to protected paths (factory/lib/paths.mjs) unless the active work order is `risk: high` and its task lists
//   the file. Specs are not protected: agents may draft specs; a human code owner agrees to them.
// - Blocks edits to specs/approvals.json: only `npm run factory -- approve`, run by a human, writes it.
// - Blocks edits to product code (app/, packages/, harness/, e2e/) unless .factory/active.json names a compiled work order
//   and a task whose file globs match the file. Draft work orders (compile --draft) are accepted here; CI's spec-gate is not.
// Contract (Claude Code hooks docs, see docs/decisions/0002-claude-code-hooks.md): JSON on stdin; exit 0 = allow; exit 2 =
// block, stderr is shown to the agent. Parses the tool input JSON; never regex over a command string. Fast, no network, no git.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APPROVALS_FILE, isProduct, isProtected } from "../../factory/lib/paths.mjs";
import { matchAny } from "../../factory/lib/glob.mjs";

/** Rule ids; each has a negative test tagged `@guard hook/guard-paths/<id>` (doctor checks). */
export const RULES = [
  "malformed-input",
  "protected",
  "approvals-file",
  "product-needs-workorder",
  "workorder-task",
  "outside-task-globs",
];

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function repoRootOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function findWorkorder(root, spec) {
  const specs = path.join(root, "specs");
  if (!existsSync(specs)) return null;
  const dir = readdirSync(specs).find((d) => d.startsWith(`${String(spec).padStart(3, "0")}-`));
  const file = dir && path.join(specs, dir, "workorder.json");
  return file && existsSync(file) ? { rel: `specs/${dir}/workorder.json`, data: JSON.parse(readFileSync(file, "utf8")) } : null;
}

/** Decide one tool call. Returns { allow: true } or { allow: false, rule, message }. */
export function decide(input, env = process.env) {
  if (!input || typeof input !== "object")
    return { allow: false, rule: "malformed-input", message: "hook input is not a JSON object" };
  if (!FILE_TOOLS.has(input.tool_name)) return { allow: true };
  const ti = input.tool_input;
  const raw = ti && (ti.file_path ?? ti.notebook_path);
  if (typeof raw !== "string" || raw === "")
    return {
      allow: false,
      rule: "malformed-input",
      message: `${input.tool_name} call has no tool_input.file_path; refusing rather than guessing`,
    };
  const base = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const file = path.resolve(base, raw);
  const root = repoRootOf(file);
  // Only this repository is guarded (a checkout or worktree that carries this hook).
  if (!root || !existsSync(path.join(root, ".claude/hooks/guard-paths.mjs"))) return { allow: true };
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.startsWith("..")) return { allow: true };

  if (rel === APPROVALS_FILE)
    return {
      allow: false,
      rule: "approvals-file",
      message: `${rel} records human agreement and is written only by 'npm run factory -- approve NNN --by <email>', run by a human code owner after reviewing the spec. Never write an approval yourself.`,
    };

  const protectedPath = isProtected(rel);
  if (!protectedPath && !isProduct(rel)) return { allow: true };

  let active = null;
  const activeFile = path.join(root, ".factory/active.json");
  if (existsSync(activeFile)) {
    try {
      active = JSON.parse(readFileSync(activeFile, "utf8"));
    } catch {
      active = null;
    }
  }
  const how =
    "Fix: run /build-task NNN/T-xxx for a compiled work order whose task lists this file (it writes .factory/active.json). No spec yet? Shape one with /shape-spec, then /plan-spec and 'npm run factory -- compile NNN --draft'.";
  if (!active?.spec || !active?.task)
    return {
      allow: false,
      rule: protectedPath ? "protected" : "product-needs-workorder",
      message: protectedPath
        ? `${rel} is a protected path (plan 5.6). Only a 'risk: high' work order whose task lists it may change it, and a human code owner reviews it. ${how}`
        : `${rel} is product code and there is no active work order (.factory/active.json). ${how}`,
    };
  let wo;
  try {
    wo = findWorkorder(root, active.spec);
  } catch (e) {
    return {
      allow: false,
      rule: "workorder-task",
      message: `the work order for spec ${active.spec} is not valid JSON (${e.message}). Recompile: npm run factory -- compile ${active.spec} --draft`,
    };
  }
  if (!wo)
    return {
      allow: false,
      rule: "workorder-task",
      message: `.factory/active.json names spec ${active.spec}, which has no compiled work order. Run: npm run factory -- compile ${active.spec} --draft`,
    };
  const task = (wo.data.tasks ?? []).find((t) => t.id === active.task);
  if (!task)
    return {
      allow: false,
      rule: "workorder-task",
      message: `${wo.rel} has no task ${active.task}. Pick a task from it with /build-task.`,
    };
  if (!matchAny(task.files ?? [], rel))
    return {
      allow: false,
      rule: "outside-task-globs",
      message: `${rel} is outside task ${wo.data.spec}/${task.id}'s files (${(task.files ?? []).join(", ")}). Stay inside the task, or change tasks.yaml (a planning change) and recompile.`,
    };
  if (protectedPath && wo.data.risk !== "high")
    return {
      allow: false,
      rule: "protected",
      message: `${rel} is a protected path; spec ${wo.data.spec} is risk '${wo.data.risk}', and only a 'risk: high' spec may change protected paths.`,
    };
  return { allow: true };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    input = null;
  }
  const d = decide(input);
  if (!d.allow) {
    process.stderr.write(`guard-paths [${d.rule}]: blocked. ${d.message}\n`);
    process.exit(2);
  }
  process.exit(0);
}
