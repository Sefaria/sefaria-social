// Acceptance tests for spec 081 (agent QA lane). CLI only, so they load on the merge base and fail there on an assertion.
// @feature OPS-082 QA surfaces derived from the diff through the surface map
// @feature OPS-083 QA recount applies what a pass means
// @feature OPS-084 Agent QA lane posts one evidence comment
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO, cli, makeRepo, specFiles } from "./helpers.mjs";

const MAP = [
  "surfaces:",
  "  room-lobby:",
  "    description: lobby",
  "    reach: harness",
  "    paths: ['app/src/features/room/**']",
  "shared: ['app/src/lib/**']",
  "ignore: ['docs/**']",
  "",
].join("\n");
const tmp = () => mkdtempSync(path.join(tmpdir(), "acc081-"));
const J = (o) => ({
  id: "J-001",
  surface: "feed",
  persona: "signed-out",
  title: "feed renders",
  attempts: [{ outcome: "pass", evidence: ['heading "Sefaria Social"'] }],
  ...o,
});
const evidence = (journeys, extra = {}) => {
  const f = path.join(tmp(), "evidence.json");
  writeFileSync(f, JSON.stringify({ sha: "abc", journeys, ...extra }));
  return f;
};

describe("spec 081: agent QA", () => {
  // @ac 081/AC-001
  it("maps changed files to surfaces through the surface map: direct paths, shared code by its importers, docs ignored", () => {
    const r = cli(REPO, [
      "surfaces",
      "--files",
      "app/src/features/feed/FeedPage.tsx",
      "app/src/lib/surface-info.ts",
      "docs/ROUTING.md",
      "--json",
    ]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(Object.keys(j.surfaces).sort()).toEqual(["feed", "host-integration"]);
    expect(j.surfaces.feed).toEqual([
      "app/src/features/feed/FeedPage.tsx",
      "app/src/lib/surface-info.ts (shared, imported by feed)",
    ]);
    expect(j.ignored).toEqual(["docs/ROUTING.md"]);
  });

  // @ac 081/AC-002
  it("a changed product file that maps to no surface fails the derivation with the fix", () => {
    const root = makeRepo({ "factory/surface-map.yaml": MAP, "app/src/stray/x.ts": "export {};\n" });
    const r = cli(root, ["surfaces", "--files", "app/src/stray/x.ts", "app/src/features/room/Lobby.tsx"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("x 1 changed product file(s) map to no surface: app/src/stray/x.ts");
    expect(r.stdout).toContain("surfaces: room-lobby (2 changed file(s))");
  });

  // @ac 081/AC-003
  it("doctor fails when a spec names a surface the map does not have", () => {
    const root = makeRepo({ "factory/surface-map.yaml": MAP, ...specFiles("001") });
    const r = cli(root, ["doctor", "--skip-tests"]);
    expect(r.stderr).toContain("x [surface-map] spec 001 names surface 'feed', which is not in factory/surface-map.yaml");
  });

  // @ac 081/AC-004
  it("the recount reports a retry as failed-then-recovered, an unreachable surface as cannot-reach, and a pass without evidence as a failure", () => {
    const r = cli(REPO, [
      "qa-recount",
      evidence([
        J(),
        J({
          id: "J-002",
          attempts: [
            { outcome: "fail", evidence: [] },
            { outcome: "pass", evidence: ["ok"] },
          ],
        }),
        J({ id: "J-003", cannot_reach: "harness: not-built (P1)", attempts: [] }),
        J({ id: "J-004", attempts: [{ outcome: "pass", evidence: [] }] }),
      ]),
    ]);
    expect(r.stdout).toContain("qa-recount: FAIL (1 pass, 1 failed-then-recovered, 1 cannot-reach, 1 fail, 0 not-run)");
    expect(r.code).toBe(1);
  });

  // @ac 081/AC-005
  it("a surface the diff touches with zero journeys blocks the report; a claim that differs from the recount is reported", () => {
    const surfaces = path.join(tmp(), "s.json");
    writeFileSync(surfaces, JSON.stringify({ surfaces: { feed: [], session: [] } }));
    const r = cli(REPO, ["qa-recount", evidence([J()], { claimed: { pass: 3 } }), "--surfaces", surfaces]);
    expect(r.stdout).toContain("qa-recount: BLOCKED");
    expect(r.stdout).toContain("blocked: surface 'session' changed in this PR but has zero journeys");
    expect(r.stdout).toContain("mismatch: runner claimed 3 pass, recount finds 1");
  });

  // @ac 081/AC-006
  it("renders one evidence comment and one issue per failure; a runner that wrote no evidence yields cannot-reach, not a pass", () => {
    const dir = tmp();
    const r = cli(REPO, [
      "qa-recount",
      evidence([
        J(),
        J({ id: "J-002", attempts: [{ outcome: "fail", evidence: [], note: "no Join button" }], transcript: "opened lobby" }),
      ]),
      "--comment",
      path.join(dir, "c.md"),
      "--issues",
      path.join(dir, "i"),
    ]);
    expect(r.code).toBe(1);
    expect(readFileSync(path.join(dir, "c.md"), "utf8").match(/^## Agent QA/gm)).toEqual(["## Agent QA"]);
    expect(readdirSync(path.join(dir, "i"))).toEqual(["J-002.md"]);
    const s = path.join(dir, "s.json");
    writeFileSync(s, JSON.stringify({ surfaces: { feed: [] } }));
    const fb = spawnSync(
      process.execPath,
      [path.join(REPO, "e2e/qa/env.mjs"), "fallback-evidence", s, "missing.json", "--out", path.join(dir, "e.json")],
      { encoding: "utf8" },
    );
    expect(fb.status).toBe(0);
    expect(cli(REPO, ["qa-recount", path.join(dir, "e.json")]).stdout).toContain(
      "0 pass, 0 failed-then-recovered, 1 cannot-reach",
    );
  });

  // @ac 081/AC-007
  it("agent-qa.yml builds the environment with Postgres, runs planner, runner and skeptic separately, and posts exactly one comment", () => {
    const f = path.join(REPO, ".github/workflows/agent-qa.yml");
    expect(existsSync(f)).toBe(true);
    const qa = YAML.parse(readFileSync(f, "utf8")).jobs.qa;
    expect(qa.services.postgres.image).toBe("postgres:15");
    expect(qa.steps.filter((s) => /claude-code-action/.test(s.uses ?? "")).map((s) => s.id)).toEqual([
      "planner",
      "runner",
      "skeptic",
    ]);
    expect(qa.steps.filter((s) => /gh pr comment "\$PR_NUMBER"/.test(s.run ?? ""))).toHaveLength(1);
    expect(qa.steps.some((s) => /node e2e\/qa\/env\.mjs up/.test(s.run ?? ""))).toBe(true);
  });
});
