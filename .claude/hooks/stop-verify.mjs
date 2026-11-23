#!/usr/bin/env node
// Stop hook (plan 5.4): before the agent stops, run the fast checks on what it changed: typecheck, ESLint on the changed
// files, and the unit tests related to them. On failure exit 2, so the agent continues with the errors as feedback.
// Loop guard: when stop_hook_active is true (the agent is already continuing because of this hook), exit 0.
// Reads git state with --no-optional-locks (no git writes); no network.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Rule ids; each has a negative test tagged `@guard hook/stop-verify/<id>` (doctor checks). */
export const RULES = ["loop-guard", "checks-fail"];

const SOURCE = /\.(ts|tsx|mjs|js|cjs)$/;

function rootOf(dir) {
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function changed(root) {
  const r = spawnSync("git", ["--no-optional-locks", "status", "--porcelain=v1", "-uall"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).split(" -> ").pop())
    .filter((f) => existsSync(path.join(root, f)));
}

export function verify(root) {
  const files = changed(root).filter((f) => !f.endsWith(".md"));
  if (files.length === 0) return [];
  const failures = [];
  const run = (label, cmd, args) => {
    const r = spawnSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 150_000,
      env: { ...process.env, FORCE_COLOR: "0", CI: "true" },
    });
    if (r.status !== 0)
      failures.push(`${label} failed:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-30).join("\n")}`);
  };
  const pkg = existsSync(path.join(root, "package.json"))
    ? JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    : {};
  if (pkg.scripts?.typecheck) run("typecheck (npm run typecheck)", "npm", ["run", "-s", "typecheck"]);
  const src = files.filter((f) => SOURCE.test(f));
  const bin = (n) => path.join(root, "node_modules", ".bin", n);
  if (src.length && existsSync(bin("eslint")))
    run(`eslint (${src.length} changed file(s))`, bin("eslint"), ["--max-warnings=0", ...src]);
  if (src.length && existsSync(bin("vitest")))
    run("unit tests related to the change (vitest related)", bin("vitest"), ["related", "--run", "--passWithNoTests", ...src]);
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let input = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    input = {};
  }
  if (input.stop_hook_active === true) process.exit(0);
  const root = rootOf(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) process.exit(0);
  const failures = verify(root);
  if (failures.length) {
    process.stderr.write(
      `stop-verify: the fast checks fail on your changes. Fix them before stopping.\n\n${failures.join("\n\n")}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
}
