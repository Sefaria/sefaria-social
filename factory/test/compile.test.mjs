// `factory compile`: every rule of plan 5.3 has a negative test (tagged @guard compile/<rule>).
import { describe, expect, it } from "vitest";
import { cli, makeRepo, read, specFiles, write, exists } from "./helpers.mjs";

const approve = (root, id = "001") => cli(root, ["approve", id, "--by", "owner@example.org"]);

describe("compile", () => {
  it("compiles an approved spec into a deterministic work order and a planned atlas entry", () => {
    const root = makeRepo(specFiles());
    expect(approve(root).code).toBe(0);
    const first = cli(root, ["compile", "001"]);
    expect(first.code).toBe(0);
    const wo = JSON.parse(read(root, "specs/001-hello/workorder.json"));
    expect(wo.approved).toBe(true);
    expect(wo.approved_by).toBe("owner@example.org");
    expect(wo.acs).toEqual([
      {
        ac: "AC-001",
        text: "WHEN a reader opens the page THE SYSTEM SHALL say hello",
        scenarios: ["AC-001 says hello"],
        passes: false,
        evidence: null,
      },
    ]);
    expect(wo.tasks.map((t) => t.id)).toEqual(["T-001"]);
    const bytes = read(root, "specs/001-hello/workorder.json");
    expect(cli(root, ["compile", "001"]).code).toBe(0);
    expect(read(root, "specs/001-hello/workorder.json")).toBe(bytes);
    const atlas = JSON.parse(read(root, "docs/features/features.json"));
    expect(atlas.features.map((f) => [f.id, f.status, f.spec, f.acs])).toEqual([["HOST-001", "planned", "001", ["001/AC-001"]]]);
  });

  // @guard compile/approved
  it("refuses an unapproved spec, and --draft compiles it marked approved:false", () => {
    const root = makeRepo(specFiles());
    const r = cli(root, ["compile", "001"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[approved] spec 001 not approved: specs/approvals.json has no entry for 001");
    expect(exists(root, "specs/001-hello/workorder.json")).toBe(false);
    const d = cli(root, ["compile", "001", "--draft"]);
    expect(d.code).toBe(0);
    expect(d.stdout).toContain("DRAFT");
    expect(JSON.parse(read(root, "specs/001-hello/workorder.json")).approved).toBe(false);
  });

  // @guard compile/approved
  it("refuses a spec whose content changed after approval", () => {
    const root = makeRepo(specFiles());
    expect(approve(root).code).toBe(0);
    write(root, {
      "specs/001-hello/acceptance.feature": "Feature: Hello\n\n  @AC-001\n  Scenario: changed wording\n    Then hi\n",
    });
    const r = cli(root, ["compile", "001"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("spec or feature file changed since");
  });

  // @guard compile/spec-valid
  it("refuses a spec whose frontmatter breaks the schema or misses a section", () => {
    const root = makeRepo(specFiles("001", { risk: "medium" }));
    write(root, { "specs/001-hello/spec.md": read(root, "specs/001-hello/spec.md").replace("## Out of scope\nNothing.\n", "") });
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("/risk must be equal to one of the allowed values (allowed: normal, high)");
    expect(r.stderr).toContain("has no '## Out of scope' section");
  });

  // @guard compile/feature-scenarios
  it("refuses an AC without a scenario and a scenario tagged with an unknown AC", () => {
    const root = makeRepo(specFiles("001", { feature: "Feature: Hello\n\n  @AC-009\n  Scenario: stray\n    Then x\n" }));
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("AC-001 has no scenario");
    expect(r.stderr).toContain("is tagged @AC-009, but spec.md has no AC-009");
  });

  // @guard compile/ac-tasks
  it("refuses an AC that no task covers", () => {
    const root = makeRepo(
      specFiles("001", {
        acs: ["AC-001", "AC-002"],
        tasks: `- id: T-001\n  title: One\n  acs: [AC-001]\n  files: ["app/src/a.ts"]\n  depends_on: []\n  verify: ["npm test"]\n`,
      }),
    );
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("AC-002 is not covered by any task");
  });

  // @guard compile/task-fields
  it("refuses a task with no verify command or no files", () => {
    const root = makeRepo(
      specFiles("001", { tasks: `- id: T-001\n  title: One\n  acs: [AC-001]\n  files: []\n  depends_on: []\n  verify: []\n` }),
    );
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("/0/files must NOT have fewer than 1 items");
    expect(r.stderr).toContain("/0/verify must NOT have fewer than 1 items");
  });

  // @guard compile/globs
  it("refuses whole-repo, climbing and spec-asset globs", () => {
    const root = makeRepo(
      specFiles("001", {
        tasks: `- id: T-001\n  title: One\n  acs: [AC-001]\n  files: ["**", "../outside.ts", "specs/001-hello/spec.md"]\n  depends_on: []\n  verify: ["npm test"]\n`,
      }),
    );
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("file glob '**' matches the whole repo");
    expect(r.stderr).toContain("file glob '../outside.ts' climbs out of the repo");
    expect(r.stderr).toContain("is a spec asset; a task never edits its spec");
  });

  // @guard compile/verify-commands
  it("refuses verify commands that are not npm/npx/node or name a missing script", () => {
    const root = makeRepo(
      specFiles("001", {
        tasks: `- id: T-001\n  title: One\n  acs: [AC-001]\n  files: ["app/src/a.ts"]\n  depends_on: []\n  verify: ["npm run nope", "rm -rf dist"]\n`,
      }),
    );
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`'npm run nope': package.json has no "nope" script`);
    expect(r.stderr).toContain("'rm -rf dist' must start with npm, npx or node");
  });

  // @guard compile/no-cycles
  it("refuses a dependency cycle", () => {
    const t = (id, dep) =>
      `- id: ${id}\n  title: Task ${id}\n  acs: [AC-001]\n  files: ["app/src/${id}.ts"]\n  depends_on: [${dep}]\n  verify: ["npm test"]\n`;
    const root = makeRepo(specFiles("001", { tasks: t("T-001", "T-002") + t("T-002", "T-001") }));
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("task dependencies form a cycle: T-001 -> T-002 -> T-001");
  });

  // @guard compile/protected-paths
  it("refuses a task glob on a protected path unless the spec is risk: high", () => {
    const tasks = `- id: T-001\n  title: Touch auth\n  acs: [AC-001]\n  files: ["app/src/server/auth/token.ts", "app/src/**/*.ts"]\n  depends_on: []\n  verify: ["npm test"]\n`;
    const root = makeRepo(specFiles("001", { tasks }));
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("file glob 'app/src/server/auth/token.ts' reaches protected path 'app/src/server/auth/**'");
    expect(r.stderr).toContain("file glob 'app/src/**/*.ts' reaches protected path 'app/src/server/auth/**'");
    const high = makeRepo(specFiles("001", { tasks, risk: "high" }));
    expect(cli(high, ["compile", "001", "--draft"]).code).toBe(0);
  });

  // @guard compile/atlas-ids
  it("refuses a task that completes a feature its spec does not list", () => {
    const root = makeRepo(specFiles("001", { completes: ["ROOM-777"] }));
    const r = cli(root, ["compile", "001", "--draft"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("T-001 completes ROOM-777, which the spec's features list does not name");
  });

  it("records a later spec that changes an existing feature in its 'changed' list", () => {
    const root = makeRepo(specFiles());
    expect(cli(root, ["compile", "001", "--draft"]).code).toBe(0);
    write(root, specFiles("002", { slug: "more", title: "More hello" }));
    expect(cli(root, ["compile", "002", "--draft"]).code).toBe(0);
    const f = JSON.parse(read(root, "docs/features/features.json")).features[0];
    expect([f.spec, f.changed]).toEqual(["001", [{ spec: "002", date: null }]]);
  });
});
