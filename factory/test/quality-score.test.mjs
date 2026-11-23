// docs/QUALITY_SCORE.md is generated, never typed (plan 5.9). Tagged @guard quality-score/<rule>.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, cli, makeRepo, write } from "./helpers.mjs";
import { buildQualityScore } from "../quality-score.mjs";

function repo(files = {}) {
  const root = makeRepo(files);
  mkdirSync(path.join(root, "factory"), { recursive: true });
  for (const f of ["factory/surface-map.yaml", "factory/quarantine.yaml"]) cpSync(path.join(REPO, f), path.join(root, f));
  return root;
}

describe("quality score", () => {
  it("counts test files per level for each surface, from paths and from the atlas", () => {
    const root = repo({
      "app/src/features/feed/Feed.test.tsx": "x",
      "e2e/feed.spec.ts": "x",
      "docs/features/features.json": { features: [{ id: "FEED-001", surfaces: ["feed"], tests: ["e2e/feed.spec.ts"] }] },
    });
    const row = buildQualityScore(root).rows.find((r) => r.key === "feed");
    expect(row).toEqual({
      key: "feed",
      perLevel: { L0: 0, L1: 1, L2: 0, L3: 0, L4a: 1 },
      features: 1,
      quarantined: 0,
      escaped: 0,
      flaky: null,
    });
  });

  // @guard quality-score/fresh
  it("--check fails when the committed file is stale", () => {
    const root = repo({ "app/src/features/feed/Feed.test.tsx": "x" });
    expect(cli(root, ["quality-score"]).code).toBe(0);
    expect(cli(root, ["quality-score", "--check"]).code).toBe(0);
    write(root, { "app/src/features/room/Lobby.test.tsx": "x" });
    const r = cli(root, ["quality-score", "--check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("docs/QUALITY_SCORE.md is stale");
  });
});
