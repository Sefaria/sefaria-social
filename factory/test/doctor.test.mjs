// `factory doctor`: each check has a fixture that breaks it (tagged @guard doctor/<check>), and the real repo passes.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, cli, makeRepo, read, write } from "./helpers.mjs";
import {
  allGuards,
  checkAgents,
  checkClaudeMd,
  checkCodeowners,
  checkDocLinks,
  checkGuardTests,
  checkHooks,
  checkPinnedContract,
  checkRequiredChecks,
  checkResultNeeds,
  checkSkills,
} from "../doctor.mjs";

/** A fixture with copies of the real repo's factory-facing files, so each test can break one thing. */
function copyOfRepo() {
  const root = makeRepo();
  for (const rel of [
    ".claude",
    ".github",
    "factory/test",
    "docs",
    "CLAUDE.md",
    "README.md",
    "REVIEW.md",
    "AGENTS.md",
    "specs",
    "factory/README.md",
  ]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true });
  }
  return root;
}

describe("doctor", () => {
  it("passes on this repository (guard tests are run by the factory project itself)", () => {
    const r = cli(REPO, ["doctor", "--skip-tests"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("passes on an unbroken copy of the repo", () => {
    const root = copyOfRepo();
    const problems = [
      checkHooks,
      checkGuardTests,
      checkRequiredChecks,
      checkResultNeeds,
      checkSkills,
      checkAgents,
      checkCodeowners,
      checkClaudeMd,
      checkDocLinks,
    ].flatMap((f) => f(root));
    expect(problems).toEqual([]);
  });

  // @guard doctor/hooks-registered
  it("fails when a registered hook is missing or a hook script is unregistered", () => {
    const root = copyOfRepo();
    write(root, { ".claude/hooks/stop-verify.mjs": null, ".claude/hooks/rogue.mjs": "// not registered\n" });
    expect(checkHooks(root)).toEqual([
      "hook .claude/hooks/stop-verify.mjs is registered in .claude/settings.json but missing",
      "hook .claude/hooks/rogue.mjs exists but is not registered in .claude/settings.json",
    ]);
  });

  // @guard doctor/guard-tests
  it("fails when a guard has no negative test", () => {
    const root = copyOfRepo();
    const gate = read(root, "factory/test/gate.test.mjs").replaceAll("@guard gate/spec-and-code", "(tag removed)");
    write(root, { "factory/test/gate.test.mjs": gate });
    expect(checkGuardTests(root)).toEqual([
      "guard 'gate/spec-and-code' has no negative test (tag one with '@guard gate/spec-and-code' in factory/test/)",
    ]);
    expect(checkGuardTests(root, [...allGuards(), "gate/brand-new-rule"])).toContain(
      "guard 'gate/brand-new-rule' has no negative test (tag one with '@guard gate/brand-new-rule' in factory/test/)",
    );
  });

  // @guard doctor/guard-tests
  it("fails when a guard's negative test does not pass (the guard did not go red)", () => {
    const root = copyOfRepo();
    // A negative test that expects a refusal the code does not give: doctor's test run must fail.
    write(root, {
      "factory/test/fake.test.mjs": `// @guard gate/housekeeping\nimport { it, expect } from "vitest";\nit("expects red", () => expect(0).toBe(1));\n`,
      "factory/test/gate.test.mjs": null,
    });
    for (const f of ["compile", "approve", "atlas", "prove-red", "hooks", "doctor"])
      write(root, { [`factory/test/${f}.test.mjs`]: null });
    const r = cli(root, ["doctor"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("guard negative tests failed (a guard did not turn red when its fault was injected)");
  });

  // @guard doctor/required-checks
  it("fails when the docs name a required check that is not a job", () => {
    const root = copyOfRepo();
    write(root, { "docs/runbooks/extra.md": "# Extra\n\n## Required checks\n\n- `e2e-reader` — required from P1.\n" });
    expect(checkRequiredChecks(root)).toEqual([
      "required check 'e2e-reader' (named in docs/runbooks/extra.md) is not a job in .github/workflows/",
    ]);
  });

  // @guard doctor/result-needs
  it("fails when a CI job is not aggregated by result", () => {
    const root = copyOfRepo();
    write(root, {
      ".github/workflows/ci.yml": read(root, ".github/workflows/ci.yml").replace(
        "needs: [changes, static, unit, build, spec-gate, prove-red]",
        "needs: [changes, static, unit, build, spec-gate]",
      ),
    });
    expect(checkResultNeeds(root)).toContain(
      "ci.yml job 'prove-red' is not in result.needs, so its failure would not block a merge",
    );
  });

  // @guard doctor/skills
  it("fails on a skill with bad frontmatter, no when-not, or a $<digit> in SKILL.md", () => {
    const root = copyOfRepo();
    write(root, {
      ".claude/skills/broken/SKILL.md":
        "---\nname: Broken Skill\ndescription: Does things. Use when needed.\n---\n\nRun `echo $1`.\n",
    });
    const p = checkSkills(root);
    expect(p).toContain(".claude/skills/broken/SKILL.md frontmatter name 'Broken Skill' must equal the folder name 'broken'");
    expect(p).toContain(`.claude/skills/broken/SKILL.md description must say when not to use it ("Do not use …")`);
    expect(p).toContain(
      ".claude/skills/broken/SKILL.md:6 contains '$' followed by a digit, which skill arguments replace; move the snippet to a script",
    );
  });

  // @guard doctor/agents
  it("fails when a read-only agent is given write tools, or an agent lists no tools", () => {
    const root = copyOfRepo();
    write(root, {
      ".claude/agents/reviewer.md": read(root, ".claude/agents/reviewer.md").replace(
        "tools: Read, Grep, Glob",
        "tools: Read, Grep, Glob, Edit",
      ),
      ".claude/agents/loose.md": "---\nname: loose\ndescription: x\n---\n",
    });
    expect(checkAgents(root)).toEqual([
      ".claude/agents/loose.md must list its tools (least privilege)",
      ".claude/agents/reviewer.md may use only Read, Grep, Glob; it lists Edit",
    ]);
  });

  // @guard doctor/codeowners
  it("fails when a protected path has no code owner", () => {
    const root = copyOfRepo();
    write(root, {
      ".github/CODEOWNERS": read(root, ".github/CODEOWNERS")
        .replace(/^\/factory\/.*$/m, "")
        .replace(/^\/specs\/.*$/m, ""),
    });
    expect(checkCodeowners(root)).toEqual([
      "protected path 'factory/**' has no code owner in .github/CODEOWNERS",
      "protected path 'specs/**' has no code owner in .github/CODEOWNERS",
      "protected path 'specs/approvals.json' has no code owner in .github/CODEOWNERS",
    ]);
  });

  // @guard doctor/claude-md-lines
  it("fails when CLAUDE.md is over 150 lines", () => {
    const root = copyOfRepo();
    write(root, { "CLAUDE.md": Array.from({ length: 151 }, (_, i) => `line ${i}`).join("\n") + "\n" });
    expect(checkClaudeMd(root)).toEqual(["CLAUDE.md has 151 lines (limit 150); move procedures into skills"]);
  });

  // @guard doctor/doc-links
  it("fails on a broken relative docs link, and ignores links in code", () => {
    const root = copyOfRepo();
    write(root, {
      "docs/broken.md":
        "See [the plan](PLAN.md), [gone](./nope.md#x) and `[code](missing.md)`.\n\n```\n[block](missing.md)\n```\n",
    });
    expect(checkDocLinks(root)).toEqual(["docs/broken.md:1 links to './nope.md#x', which does not exist"]);
  });

  // @guard doctor/pinned-contract
  it("fails when the pinned contract differs from its recorded hash", () => {
    const root = makeRepo({
      "packages/host-contract/pinned/surface-host.v1.ts": "export type X = 1;\n",
      "packages/host-contract/pinned/contract.sha256": `sha256:${"0".repeat(64)}\n`,
    });
    expect(checkPinnedContract(root)[0]).toMatch(
      /^pinned contract hash sha256:[0-9a-f]{64} differs from the recorded sha256:0{64}/,
    );
  });
});
