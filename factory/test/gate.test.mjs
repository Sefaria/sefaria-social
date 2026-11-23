// The CI spec gate (plan 5.4): for each rule, a fixture repo that breaks it and an assertion that the gate goes red.
// Tagged @guard gate/<rule>; `factory doctor` fails if a gate rule has no such test.
import { describe, expect, it } from "vitest";
import { BUILT_FEATURE, cli, commit, git, makeRepo, read, specFiles, write } from "./helpers.mjs";

const gate = (root) => cli(root, ["gate", "--base", "main"]);
const TRAILERS = "\n\nSpec: 001\nTask: T-001";
const HELLO = {
  "app/src/hello.ts": "export const hello = 'hello';\n",
  "app/src/hello.test.ts": "// @feature HOST-001 Hello feature\n",
};

/** Add spec 001 on the PR branch, approved (unless draft) and compiled, and return the root. */
function withSpec(root, { draft = false, specOpts = {} } = {}) {
  write(root, specFiles("001", specOpts));
  if (!draft) expect(cli(root, ["approve", "001", "--by", "owner@example.org"]).code).toBe(0);
  expect(cli(root, ["compile", "001", ...(draft ? ["--draft"] : [])]).code).toBe(0);
  return root;
}

/** Mark HOST-001 built in the atlas with a changelog line (what the PR completing T-001 does). */
const ATLAS_BUILT = {
  "docs/features/features.json": { $comment: "atlas", features: [BUILT_FEATURE()] },
  "docs/features/CHANGELOG.md": "# Feature changelog\n\n- HOST-001 Hello feature: built.\n",
};

describe("gate: lanes that need no spec", () => {
  it("passes a docs-only PR as housekeeping", () => {
    const root = makeRepo();
    commit(root, { "docs/notes.md": "# notes\n", "app/src/features/x/README.md": "# x\n" });
    const r = gate(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("lane: housekeeping");
  });

  // @guard gate/housekeeping
  it("does not treat product code, CLAUDE.md or spec files riding along with docs as housekeeping", () => {
    const root = makeRepo();
    commit(root, { "docs/notes.md": "# notes\n", "CLAUDE.md": "# changed\n" });
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no 'Spec:' trailer");
    expect(r.stderr).toContain("protected path(s): CLAUDE.md");
  });

  it("passes a small edit to an existing file in the trivial lane, with a notice", () => {
    const root = makeRepo();
    commit(root, { "app/src/existing.ts": read(root, "app/src/existing.ts").replace("v1 = 1", "v1 = 100") });
    const r = gate(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("notice: trivial lane: 2 changed line(s)");
  });

  // @guard gate/trivial-lane
  it.each([
    ["a new file", { "app/src/new.ts": "export const n = 1;\n" }, "new file(s): app/src/new.ts"],
    ["31+ changed lines", { "app/src/existing.ts": "export const all = 'replaced';\n" }, "changed lines (> 30)"],
    ["a protected path", { "factory/gate.mjs": "// edited\n" }, "protected path(s): factory/gate.mjs"],
    [
      "a dependency change",
      { "package.json": { name: "fixture", private: true, type: "module", dependencies: { leftpad: "1.0.0" } } },
      "dependency change: package.json",
    ],
  ])("refuses %s outside the trivial lane without a spec", (_name, files, why) => {
    const root = makeRepo();
    commit(root, files);
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x no 'Spec:' trailer on any commit in this PR");
    expect(r.stderr).toContain(why);
  });

  it("passes a spec-only PR and says a code owner must approve it", () => {
    const root = makeRepo();
    commit(root, specFiles());
    const r = gate(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("lane: spec");
    expect(r.stdout).toContain("a human code owner must approve it in review");
  });

  // @guard gate/spec-pr
  it("refuses a spec-only PR whose spec is invalid or whose approval is by a bot", () => {
    const root = makeRepo();
    commit(root, {
      ...specFiles("001", { risk: "whatever" }),
      "specs/approvals.json": {
        "001": { by: "ci-bot@example.org", sha: `sha256:${"0".repeat(64)}`, at: "2026-01-01T00:00:00Z" },
      },
    });
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("spec 001 is not valid");
    expect(r.stderr).toContain("spec 001 approval is by 'ci-bot@example.org', a bot or agent identity");
  });
});

describe("gate: the full lane", () => {
  it("passes a new spec, approved by a human, with its first task built and the atlas updated", () => {
    const root = withSpec(makeRepo(), { specOpts: { completes: ["HOST-001"] } });
    commit(root, { ...HELLO, ...ATLAS_BUILT }, `feat: say hello${TRAILERS}`);
    const r = gate(root);
    expect(r.stdout).toContain("spec-gate: PASS (lane: full");
    expect(r.code).toBe(0);
  });

  // @guard gate/trailers
  it("refuses product code with no Spec: trailer, naming the fix", () => {
    const root = makeRepo();
    commit(root, { "app/src/ui/Unspecced.ts": "export const x = 1;\n" }, "feat: no spec");
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x no 'Spec:' trailer on any commit in this PR");
    expect(r.stderr).toContain("fix: Build from a work order: run /build-task");
  });

  // @guard gate/trailers
  it("refuses a Spec: trailer without a Task: trailer", () => {
    const root = withSpec(makeRepo());
    commit(root, HELLO, "feat: hello\n\nSpec: 001");
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x no 'Task:' trailer");
  });

  // @guard gate/spec-exists
  it("refuses a Spec: trailer naming a spec that does not exist", () => {
    const root = makeRepo();
    commit(root, HELLO, "feat: hello\n\nSpec: 042\nTask: T-001");
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Spec: 042 — spec 042 does not exist");
  });

  // @guard gate/workorder
  it("refuses a spec with no compiled work order", () => {
    const root = makeRepo();
    write(root, specFiles());
    commit(root, HELLO, `feat: hello${TRAILERS}`);
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("spec 001 has no work order (specs/001-hello/workorder.json)");
    expect(r.stderr).toContain("npm run factory -- compile 001");
  });

  // @guard gate/workorder
  it("refuses a stale work order (tasks.yaml edited after compiling)", () => {
    const root = withSpec(makeRepo());
    write(root, {
      "specs/001-hello/tasks.yaml": read(root, "specs/001-hello/tasks.yaml").replace("Say hello", "Say hello loudly"),
    });
    commit(root, HELLO, `feat: hello${TRAILERS}`);
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("workorder.json is stale: tasks.yaml changed after it was compiled");
  });

  // @guard gate/approved
  it("reports exactly 'spec 001 not approved' for a draft work order, and nothing else", () => {
    const root = withSpec(makeRepo(), { draft: true, specOpts: { completes: ["HOST-001"] } });
    commit(root, { ...HELLO, ...ATLAS_BUILT }, `feat: hello${TRAILERS}`);
    const r = gate(root);
    expect(r.code).toBe(1);
    const failures = r.stderr.split("\n").filter((l) => l.startsWith("  x "));
    expect(failures).toEqual(["  x spec 001 not approved"]);
    expect(r.stderr).toContain("why: specs/approvals.json has no entry for 001; the work order was compiled with --draft.");
    expect(r.stderr).toContain("runs 'npm run factory -- approve 001 --by <their email>'");
  });

  // @guard gate/approved
  it("refuses an approval written for other content, and one by a bot identity", () => {
    const root = withSpec(makeRepo());
    const approvals = JSON.parse(read(root, "specs/approvals.json"));
    approvals["001"].by = "release-bot@example.org";
    commit(root, { ...HELLO, "specs/approvals.json": approvals }, `feat: hello${TRAILERS}`);
    expect(gate(root).stderr).toContain("approval is by 'release-bot@example.org', a bot or agent identity");
    approvals["001"].by = "owner@example.org";
    approvals["001"].sha = `sha256:${"1".repeat(64)}`;
    commit(root, { "specs/approvals.json": approvals }, `chore: tamper${TRAILERS}`);
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x spec 001 not approved");
    expect(r.stderr).toContain("its approval (by owner@example.org) is for different content");
  });

  // @guard gate/task-exists
  it("refuses a Task: trailer that is not in the work order", () => {
    const root = withSpec(makeRepo());
    commit(root, HELLO, "feat: hello\n\nSpec: 001\nTask: T-009");
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Task: T-009 is not a task of spec 001");
  });

  // @guard gate/task-globs
  it("refuses changed files outside the named task's globs", () => {
    const root = withSpec(makeRepo());
    commit(
      root,
      { ...HELLO, "app/src/elsewhere.ts": "export const e = 1;\n", "vitest.config.ts": "export default {};\n" },
      `feat: hello${TRAILERS}`,
    );
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "2 changed file(s) are outside the named task(s) 001/T-001: app/src/elsewhere.ts, vitest.config.ts",
    );
  });

  // @guard gate/task-globs
  it("exempts non-product files only in the PR that introduces the factory (bootstrap), never product files", () => {
    const root = withSpec(makeRepo({}, { withFactory: false }));
    commit(
      root,
      { ...HELLO, "factory/cli.mjs": "// new\n", "app/src/stray.ts": "export const s = 1;\n" },
      `feat: hello${TRAILERS}`,
    );
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("outside the named task(s) 001/T-001: app/src/stray.ts");
    expect(r.stderr).toContain("notice: bootstrap: the base has no factory/gate.mjs");
    expect(r.stderr).not.toContain("factory/cli.mjs,");
  });

  // @guard gate/spec-and-code
  it("refuses a PR that changes an agreed spec and product code together", () => {
    const root = withSpec(makeRepo());
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "spec 001 agreed");
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--ff-only", "pr");
    git(root, "checkout", "-q", "-b", "pr2");
    write(root, {
      "specs/001-hello/acceptance.feature": read(root, "specs/001-hello/acceptance.feature").replace(
        "Then it says hello",
        "Then it says hello twice",
      ),
    });
    expect(cli(root, ["approve", "001", "--by", "owner@example.org"]).code).toBe(0);
    expect(cli(root, ["compile", "001"]).code).toBe(0);
    commit(root, HELLO, `feat: hello twice${TRAILERS}`);
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("this PR changes the agreed spec 001 (specs/001-hello) and product code together");
  });

  // @guard gate/atlas
  it("refuses a task that completes a feature without updating its atlas entry and changelog", () => {
    const root = withSpec(makeRepo(), { specOpts: { completes: ["HOST-001"] } });
    commit(root, { ...HELLO, "docs/features/features.json": { $comment: "atlas", features: [] } }, `feat: hello${TRAILERS}`);
    expect(gate(root).stderr).toContain("task(s) complete HOST-001 but docs/features/features.json is not updated in this PR");
    commit(
      root,
      { "docs/features/features.json": { $comment: "atlas", features: [{ ...BUILT_FEATURE(), status: "planned", tests: [] }] } },
      `docs: atlas${TRAILERS}`,
    );
    const r = gate(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("HOST-001 is completed by this PR but its atlas entry is 'planned' with 0 test(s)");
    expect(r.stderr).toContain("docs/features/CHANGELOG.md has no line for HOST-001");
  });
});
