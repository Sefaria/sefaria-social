// The Claude Code hooks, fed real hook JSON on stdin (stdin closed afterwards), as Claude Code runs them.
// Negative tests tagged @guard hook/<hook>/<rule>.
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, commit, makeRepo, specFiles, write, cli, humanEnv } from "./helpers.mjs";

const HOOK = (name) => path.join(REPO, ".claude/hooks", name);

/** A fixture checkout that carries the guard hook (the guard only acts in repos that have it). */
function checkout(files = {}) {
  const root = makeRepo(files);
  mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  copyFileSync(HOOK("guard-paths.mjs"), path.join(root, ".claude/hooks/guard-paths.mjs"));
  return root;
}

function runHook(name, input, opts = {}) {
  const r = spawnSync(process.execPath, [HOOK(name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    cwd: opts.cwd ?? REPO,
    env: humanEnv(opts.env ?? {}),
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const write_ = (root, rel, tool = "Write") => ({
  session_id: "s",
  transcript_path: "/dev/null",
  cwd: root,
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input:
    tool === "Edit"
      ? { file_path: path.join(root, rel), old_string: "a", new_string: "b" }
      : { file_path: path.join(root, rel), content: "x" },
  tool_use_id: "toolu_1",
});

function withWorkorder(root, { risk = "normal", files } = {}) {
  write(
    root,
    specFiles("001", {
      risk,
      tasks: files
        ? `- id: T-001\n  title: Work\n  acs: [AC-001]\n  files: [${files.map((f) => JSON.stringify(f)).join(", ")}]\n  depends_on: []\n  verify: ["npm test"]\n`
        : undefined,
    }),
  );
  expect(cli(root, ["compile", "001", "--draft"]).code).toBe(0);
  write(root, { ".factory/active.json": { spec: "001", task: "T-001" } });
  return root;
}

describe("guard-paths hook", () => {
  it("allows docs, specs and files outside the repo", () => {
    const root = checkout();
    expect(runHook("guard-paths.mjs", write_(root, "docs/notes.md")).code).toBe(0);
    expect(runHook("guard-paths.mjs", write_(root, "specs/001-hello/spec.md")).code).toBe(0);
    expect(runHook("guard-paths.mjs", { ...write_(root, "x"), tool_input: { file_path: "/tmp/elsewhere/file.ts" } }).code).toBe(
      0,
    );
    expect(
      runHook("guard-paths.mjs", { ...write_(root, "x"), tool_name: "Bash", tool_input: { command: "echo > app/src/x.ts" } })
        .code,
    ).toBe(0);
  });

  // @guard hook/guard-paths/product-needs-workorder
  it("blocks product code with no active work order, and says how to fix it", () => {
    const root = checkout();
    const r = runHook("guard-paths.mjs", write_(root, "app/src/ui/Unspecced.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "guard-paths [product-needs-workorder]: blocked. app/src/ui/Unspecced.ts is product code and there is no active work order",
    );
    expect(r.stderr).toContain("run /build-task NNN/T-xxx");
  });

  it("allows product code inside the active (draft) work order's task globs", () => {
    const root = withWorkorder(checkout());
    expect(runHook("guard-paths.mjs", write_(root, "app/src/hello.ts", "Edit")).code).toBe(0);
  });

  // @guard hook/guard-paths/outside-task-globs
  it("blocks product code outside the active task's globs", () => {
    const root = withWorkorder(checkout());
    const r = runHook("guard-paths.mjs", write_(root, "packages/session/src/x.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "packages/session/src/x.ts is outside task 001/T-001's files (app/src/hello.ts, app/src/hello.test.ts)",
    );
  });

  // @guard hook/guard-paths/workorder-task
  it("blocks when active.json names a spec with no work order or an unknown task", () => {
    const root = checkout();
    write(root, { ".factory/active.json": { spec: "042", task: "T-001" } });
    expect(runHook("guard-paths.mjs", write_(root, "app/src/hello.ts")).stderr).toContain(
      "names spec 042, which has no compiled work order",
    );
    withWorkorder(root);
    write(root, { ".factory/active.json": { spec: "001", task: "T-009" } });
    const r = runHook("guard-paths.mjs", write_(root, "app/src/hello.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("specs/001-hello/workorder.json has no task T-009");
  });

  // @guard hook/guard-paths/protected
  it("blocks protected paths, even inside a task's globs, unless the work order is risk: high", () => {
    const root = checkout();
    for (const rel of [
      ".github/workflows/ci.yml",
      "factory/gate.mjs",
      "CLAUDE.md",
      ".claude/settings.json",
      "app/src/server/auth/token.ts",
    ]) {
      const r = runHook("guard-paths.mjs", write_(root, rel));
      expect(r.code, rel).toBe(2);
      expect(r.stderr).toContain(`guard-paths [protected]: blocked. ${rel} is a protected path`);
    }
    const high = withWorkorder(checkout(), { risk: "high", files: ["app/src/server/auth/token.ts"] });
    expect(runHook("guard-paths.mjs", write_(high, "app/src/server/auth/token.ts")).code).toBe(0);
  });

  // @guard hook/guard-paths/approvals-file
  it("blocks edits to specs/approvals.json, whatever the work order", () => {
    const root = withWorkorder(checkout(), { risk: "high", files: ["app/src/hello.ts"] });
    const r = runHook("guard-paths.mjs", write_(root, "specs/approvals.json", "Edit"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("is written only by 'npm run factory -- approve NNN --by <email>'");
  });

  // @guard hook/guard-paths/malformed-input
  it("fails closed on input it cannot read", () => {
    expect(runHook("guard-paths.mjs", "not json").code).toBe(2);
    const r = runHook("guard-paths.mjs", { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {} });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Write call has no tool_input.file_path");
  });
});

describe("stop-verify hook", () => {
  const stop = (root, extra = {}) => ({
    session_id: "s",
    transcript_path: "/dev/null",
    cwd: root,
    hook_event_name: "Stop",
    stop_hook_active: false,
    ...extra,
  });
  const failingTypecheck = {
    "package.json": {
      name: "f",
      private: true,
      type: "module",
      scripts: { typecheck: "node -e \"console.error('src/a.ts(1,1): error TS2322'); process.exit(1)\"" },
    },
  };

  // @guard hook/stop-verify/checks-fail
  it("exits 2 with the failing check's output when the fast checks fail on changed files", () => {
    const root = makeRepo(failingTypecheck);
    write(root, { "app/src/a.ts": "export const a: number = 'x';\n" });
    const r = runHook("stop-verify.mjs", stop(root), { cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("typecheck (npm run typecheck) failed:");
    expect(r.stderr).toContain("error TS2322");
  });

  it("exits 0 when nothing changed, and when the checks pass", () => {
    const root = makeRepo(failingTypecheck);
    expect(runHook("stop-verify.mjs", stop(root), { cwd: root }).code).toBe(0);
    const ok = makeRepo({ "package.json": { name: "f", private: true, scripts: { typecheck: "node -e 0" } } });
    write(ok, { "app/src/a.ts": "export const a = 1;\n" });
    expect(runHook("stop-verify.mjs", stop(ok), { cwd: ok }).code).toBe(0);
  });

  // @guard hook/stop-verify/loop-guard
  it("does not block again when Claude is already continuing because of a stop hook", () => {
    const root = makeRepo(failingTypecheck);
    write(root, { "app/src/a.ts": "export const a = 1;\n" });
    expect(runHook("stop-verify.mjs", stop(root), { cwd: root }).code).toBe(2);
    expect(runHook("stop-verify.mjs", stop(root, { stop_hook_active: true }), { cwd: root }).code).toBe(0);
  });
});

describe("post-edit-check hook", () => {
  it("formats the edited file and never blocks, reporting lint findings as additionalContext", () => {
    const root = makeRepo();
    commit(root, {});
    const file = path.join(REPO, "factory/test/.post-edit-fixture.tmp.mjs");
    // A file inside the real repo, so the repo's prettier and eslint run on it; removed afterwards.
    write(REPO, { "factory/test/.post-edit-fixture.tmp.mjs": "const   unused = 1\n" });
    try {
      const r = runHook("post-edit-check.mjs", {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: REPO,
        tool_input: { file_path: file, content: "" },
        tool_response: { filePath: file, type: "create" },
      });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(out.hookSpecificOutput.additionalContext).toContain("'unused' is assigned a value but never used");
      expect(runHook("post-edit-check.mjs", "garbage").code).toBe(0);
    } finally {
      write(REPO, { "factory/test/.post-edit-fixture.tmp.mjs": null });
    }
  });
});
