#!/usr/bin/env node
// PostToolUse hook for Edit|Write (plan 5.4): format and lint the one changed file. Never blocks: findings go back to the
// agent as additionalContext, and the hook always exits 0. No network, no git.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const PRETTIER = /\.(ts|tsx|mjs|js|cjs|json|md|css|ya?ml|html)$/;
const ESLINT = /\.(ts|tsx|mjs|js|cjs)$/;

function rootOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const raw = input.tool_input?.file_path;
  if (typeof raw !== "string") return;
  const file = path.resolve(input.cwd || process.cwd(), raw);
  const root = rootOf(file);
  if (!root || !existsSync(file) || file.includes(`${path.sep}node_modules${path.sep}`)) return;
  const bin = (n) => path.join(root, "node_modules", ".bin", n);
  const findings = [];
  if (PRETTIER.test(file) && existsSync(bin("prettier"))) {
    const r = spawnSync(bin("prettier"), ["--write", "--log-level", "warn", file], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    });
    if (r.status !== 0) findings.push(`prettier: ${(r.stderr || r.stdout).trim().split("\n").slice(0, 10).join("\n")}`);
  }
  if (ESLINT.test(file) && existsSync(bin("eslint"))) {
    const r = spawnSync(bin("eslint"), ["--max-warnings=0", file], { cwd: root, encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0) findings.push(`eslint:\n${(r.stdout || r.stderr).trim().split("\n").slice(0, 20).join("\n")}`);
  }
  if (findings.length)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `post-edit-check found problems in ${path.relative(root, file)}:\n${findings.join("\n")}`,
        },
      }),
    );
}

try {
  await main();
} catch (e) {
  process.stderr.write(`post-edit-check: skipped (${e.message})\n`);
}
process.exit(0);
