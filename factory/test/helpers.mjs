// Fixture git repositories for the factory's negative tests. Each test builds the repo it needs under a fresh temp directory,
// so no violating fixture ever sits inside the real tree.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CLI = path.join(REPO, "factory/cli.mjs");

const made = [];
afterEach(() => {
  while (made.length) rmSync(made.pop(), { recursive: true, force: true });
});

/** Environment of a person at a terminal: no agent or CI markers (approve refuses those). */
export function humanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_REMOTE", "GITHUB_ACTIONS", "CI", "FACTORY_BASE"])
    delete env[k];
  return { ...env, ...extra };
}

export function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: humanEnv({ GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" }),
  });
}

export function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (body === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
}

export function read(root, rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

export function exists(root, rel) {
  return existsSync(path.join(root, rel));
}

export function commit(root, files, message = "change") {
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD").trim();
}

export const PACKAGE_JSON = {
  name: "fixture",
  private: true,
  type: "module",
  scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." },
};

/** A fixture repo on `main` with one base commit. `withFactory` puts a factory/gate.mjs on the base (not a bootstrap PR). */
export function makeRepo(files = {}, { withFactory = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "factory-fixture-"));
  made.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "fixture@example.com");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "commit.gpgsign", "false");
  commit(
    root,
    {
      "package.json": PACKAGE_JSON,
      ".gitignore": "node_modules\n.factory/\n",
      "docs/features/features.json": { $comment: "atlas", features: [] },
      "docs/features/CHANGELOG.md": "# Feature changelog\n",
      "app/src/existing.ts": Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n",
      ...(withFactory ? { "factory/gate.mjs": "// present on the base\n" } : {}),
      ...files,
    },
    "base",
  );
  git(root, "checkout", "-q", "-b", "pr");
  return root;
}

export function linkNodeModules(root) {
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"), "dir");
}

export function cli(root, args, env = humanEnv()) {
  const r = spawnSync(process.execPath, [CLI, "--root", root, ...args], { cwd: root, encoding: "utf8", env, timeout: 120_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

/** Files for a valid spec NNN with one AC, one scenario and one task. Override any part. */
export function specFiles(id = "001", o = {}) {
  const slug = o.slug ?? "hello";
  const dir = `specs/${id}-${slug}`;
  const fm = {
    id,
    title: o.title ?? "Hello feature",
    status: o.status ?? "proposed",
    features: o.features ?? ["HOST-001"],
    owner: "fixture-owner",
    surfaces: ["feed"],
    risk: o.risk ?? "normal",
    contract_impact: "none",
    ...(o.fm ?? {}),
  };
  const fmText = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
    .join("\n");
  const acs = o.acs ?? ["AC-001"];
  const spec =
    o.spec ??
    `---\n${fmText}\n---\n## Problem\nA fixture.\n\n## Acceptance criteria\n${acs.map((a) => `- ${a} WHEN a reader opens the page THE SYSTEM SHALL say hello`).join("\n")}\n\n## Out of scope\nNothing.\n\n## Notes for the planner\nNone.\n`;
  const feature =
    o.feature ??
    `Feature: Hello\n${acs.map((a) => `\n  @${a}\n  Scenario: ${a} says hello\n    Given a page\n    Then it says hello\n`).join("")}`;
  const tasks =
    o.tasks ??
    `- id: T-001\n  title: Say hello\n  acs: [${acs.join(", ")}]\n  files: ["app/src/hello.ts", "app/src/hello.test.ts"]\n  depends_on: []\n  verify: ["npm test", "npm run typecheck"]\n${o.completes ? `  completes: [${o.completes.join(", ")}]\n` : ""}`;
  return { [`${dir}/spec.md`]: spec, [`${dir}/acceptance.feature`]: feature, [`${dir}/tasks.yaml`]: tasks };
}

export const BUILT_FEATURE = (id = "HOST-001", tests = ["app/src/hello.test.ts"], spec = "001") => ({
  id,
  area: id.split("-")[0].toLowerCase(),
  name: "Hello feature",
  description: "Says hello.",
  status: "built",
  spec,
  acs: [`${spec}/AC-001`],
  surfaces: ["feed"],
  depends_on: {},
  tests,
  since: null,
  changed: [],
});
