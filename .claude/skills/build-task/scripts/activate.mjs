#!/usr/bin/env node
// Activate a work-order task for the guard hook: writes .factory/active.json { spec, task } after checking that the work
// order and task exist. `--clear` removes it. Usage: node .claude/skills/build-task/scripts/activate.mjs NNN T-xxx
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const activeFile = path.join(root, ".factory/active.json");
const args = process.argv.slice(2);
if (args[0] === "--clear") {
  rmSync(activeFile, { force: true });
  console.log("cleared .factory/active.json");
  process.exit(0);
}
const [rawSpec, rawTask] = args[0]?.includes("/") ? args[0].split("/") : args;
if (!rawSpec || !rawTask) {
  console.error("usage: activate.mjs NNN T-xxx   (or NNN/T-xxx, or --clear)");
  process.exit(2);
}
const spec = rawSpec.padStart(3, "0");
const dir = readdirSync(path.join(root, "specs")).find((d) => d.startsWith(`${spec}-`));
const wo = dir && path.join(root, "specs", dir, "workorder.json");
if (!wo || !existsSync(wo)) {
  console.error(`spec ${spec} has no compiled work order. Run: npm run factory -- compile ${spec} --draft`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(wo, "utf8"));
const task = data.tasks.find((t) => t.id === rawTask);
if (!task) {
  console.error(`work order ${spec} has no task ${rawTask} (tasks: ${data.tasks.map((t) => t.id).join(", ")})`);
  process.exit(1);
}
mkdirSync(path.dirname(activeFile), { recursive: true });
writeFileSync(activeFile, `${JSON.stringify({ spec, task: task.id }, null, 2)}\n`);
console.log(
  `active: ${spec}/${task.id} "${task.title}"${data.approved ? "" : " (DRAFT work order: spec-gate will refuse the PR until a human approves the spec)"}`,
);
console.log(`files: ${task.files.join(", ")}`);
console.log(`verify: ${task.verify.join(" && ")}`);
