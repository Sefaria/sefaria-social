// Fixtures for the release acceptance tests (specs 019–021): a fake surface build (a manifest in the reader's format and its
// files, hashed) and a runner for the release CLI. The CLI is driven as a child process only, so the acceptance tests load on
// a merge base that has no release code and fail there on an assertion.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { REPO } from "./helpers.mjs";

const made = [];
afterEach(() => {
  while (made.length) rmSync(made.pop(), { recursive: true, force: true });
});

export function tempDir(prefix = "release-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

export const sri = (body) => `sha384-${createHash("sha384").update(body).digest("base64")}`;

/**
 * A surface build in `dir`: an entry, `chunks` (name → source), one stylesheet, a source map that the manifest does not list,
 * and manifest.json. Returns the manifest.
 */
export function makeBuild(
  dir,
  version,
  { entry = "export default { id: 'social' };\n", chunks = { a: "export const a = 1;\n" } } = {},
) {
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  const files = [];
  const put = (rel, body) => {
    writeFileSync(path.join(dir, rel), body);
    return { path: rel, integrity: sri(Buffer.from(body)) };
  };
  const e = put("assets/surface.e1.js", entry);
  for (const [name, body] of Object.entries(chunks)) files.push(put(`assets/chunk.${name}.js`, body));
  files.push(put("assets/social.c1.css", ".social{color:red}\n"));
  writeFileSync(path.join(dir, "assets/surface.e1.js.map"), '{"version":3}');
  const manifest = { version, contract: 1, entry: e.path, integrity: e.integrity, files, css: ["assets/social.c1.css"] };
  writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const RELEASE_CLI = path.join(REPO, "app", "scripts", "release", "cli.ts");

/** `npm run release -- <args>`, with RELEASE_TARGET set to `target` (or unset when null). */
export function release(args, { target, cwd = REPO } = {}) {
  const env = { ...process.env };
  delete env.RELEASE_TARGET;
  if (target) env.RELEASE_TARGET = target;
  const r = spawnSync(TSX, [RELEASE_CLI, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** scripts/rollback, as an operator runs it. */
export function rollbackScript(args, { target }) {
  const env = { ...process.env, RELEASE_TARGET: target };
  const r = spawnSync(path.join(REPO, "scripts", "rollback"), args, { cwd: REPO, env, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
