// QA surfaces come from the diff through factory/surface-map.yaml (plan 5.5). Tagged @guard surfaces/<rule>.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, cli, commit, makeRepo, write } from "./helpers.mjs";
import { deriveSurfaces, loadSurfaceMap } from "../surfaces.mjs";

function repoWithMap(files = {}) {
  const root = makeRepo(files);
  mkdirSync(path.join(root, "factory"), { recursive: true });
  cpSync(path.join(REPO, "factory/surface-map.yaml"), path.join(root, "factory/surface-map.yaml"));
  return root;
}

describe("surfaces", () => {
  it("maps feature files directly and ignores docs, specs and the factory", () => {
    const root = repoWithMap();
    const r = deriveSurfaces(root, [
      "app/src/features/feed/FeedPage.tsx",
      "packages/session/src/x.ts",
      "docs/a.md",
      "factory/gate.mjs",
    ]);
    expect(Object.keys(r.surfaces)).toEqual(["feed", "session"]);
    expect(r.ignored).toEqual(["docs/a.md", "factory/gate.mjs"]);
    expect(r.unmapped).toEqual([]);
  });

  it("maps shared code to every surface that imports it, transitively, and to none when nothing imports it", () => {
    const root = repoWithMap({
      "app/src/lib/ids.ts": "export const id = 1;\n",
      "app/src/lib/unused.ts": "export const u = 1;\n",
      "app/src/ui/Card.tsx": 'import { id } from "../lib/ids";\nexport const Card = () => id;\n',
      "app/src/features/feed/Feed.tsx": 'import { Card } from "~/ui/Card";\nexport const Feed = Card;\n',
      "app/src/features/room/Lobby.tsx": 'import { id } from "../../lib/ids";\nexport const Lobby = id;\n',
    });
    const r = deriveSurfaces(root, ["app/src/lib/ids.ts", "app/src/lib/unused.ts"]);
    expect(Object.keys(r.surfaces).sort()).toEqual(["feed", "room-lobby"]);
    expect(r.surfaces.feed).toEqual(["app/src/lib/ids.ts (shared, imported by feed)"]);
    expect(r.ignored).toEqual(["app/src/lib/unused.ts (shared, no importer yet)"]);
  });

  // @guard surfaces/unmapped
  it("fails on a changed product file that maps to no surface, naming the fix", () => {
    const root = repoWithMap({ "app/src/newarea/thing.ts": "export {};\n" });
    const r = cli(root, ["surfaces", "--files", "app/src/newarea/thing.ts"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("1 changed product file(s) map to no surface: app/src/newarea/thing.ts");
    expect(r.stderr).toContain("fix: add each path to a surface (or to 'shared' or 'ignore') in factory/surface-map.yaml");
  });

  // @guard surfaces/map-schema
  it("rejects a map whose surface has no paths or does not say how a runner reaches it", () => {
    const root = repoWithMap();
    write(root, {
      "factory/surface-map.yaml": "surfaces:\n  Bad_Key:\n    description: x\n  empty:\n    description: y\n    paths: []\n",
    });
    expect(loadSurfaceMap(root).problems).toEqual([
      "surface key 'Bad_Key' must be lowercase letters, digits and hyphens",
      "surface 'Bad_Key' has no paths",
      "surface 'Bad_Key' does not say how a runner reaches it ('reach')",
      "surface 'empty' has no paths",
      "surface 'empty' does not say how a runner reaches it ('reach')",
    ]);
  });

  it("derives from git when given --base, and prints JSON for the workflow", () => {
    const root = repoWithMap();
    commit(root, { "app/src/features/shiur/Page.tsx": "export {};\n" }, "shiur page");
    const j = cli(root, ["surfaces", "--base", "main", "--json"]);
    expect(j.code).toBe(0);
    expect(JSON.parse(j.stdout)).toEqual({
      surfaces: { shiur: ["app/src/features/shiur/Page.tsx"] },
      unmapped: [],
      ignored: ["factory/surface-map.yaml"],
    });
  });
});
