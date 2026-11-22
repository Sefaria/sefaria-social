import { describe, expect, it } from "vitest";
import { makeTree } from "./fixture";
import { checkLayers } from "./rules";

describe("(a) layer order: negative tests", () => {
  it("reports ui importing features (a higher layer)", () => {
    const root = makeTree({
      "app/src/features/feed/Feed.tsx": "export const Feed = () => null;\n",
      "app/src/ui/Card.tsx": 'import { Feed } from "../features/feed/Feed";\nexport const Card = Feed;\n',
    });
    const [v, ...rest] = checkLayers(root);
    expect(rest).toEqual([]);
    expect(v).toMatchObject({ rule: "layers", file: "app/src/ui/Card.tsx", line: 1 });
    expect(v?.message).toContain("Fix:");
  });

  it("reports lib importing ui through the ~/ alias", () => {
    const root = makeTree({ "app/src/lib/ids.ts": 'export { Card } from "~/ui/Card";\n' });
    expect(checkLayers(root).map((v) => [v.file, v.line])).toEqual([["app/src/lib/ids.ts", 1]]);
  });

  it("reports siblings at the same rank (routes ↔ surface, server ↔ ui)", () => {
    const root = makeTree({
      "app/src/surface/entry.ts": 'import "../routes/social.index";\n',
      "app/src/server/services/x.ts": 'import "../../ui/Card";\n',
    });
    expect(
      checkLayers(root)
        .map((v) => v.file)
        .sort(),
    ).toEqual(["app/src/server/services/x.ts", "app/src/surface/entry.ts"]);
  });

  it("reports a dynamic import and a layer importing an entry file", () => {
    const root = makeTree({
      "app/src/features/room/a.ts": 'export const load = () => import("../../routes/x");\n',
      "app/src/features/room/b.ts": 'import { getRouter } from "../../router";\nexport { getRouter };\n',
    });
    expect(
      checkLayers(root)
        .map((v) => v.file)
        .sort(),
    ).toEqual(["app/src/features/room/a.ts", "app/src/features/room/b.ts"]);
  });

  it("reports a file in a folder that is not a layer", () => {
    const root = makeTree({ "app/src/helpers/x.ts": "export const x = 1;\n" });
    expect(checkLayers(root).map((v) => v.file)).toEqual(["app/src/helpers/x.ts"]);
  });

  it("allows imports to the left and within a layer (no false positives)", () => {
    const root = makeTree({
      "app/src/lib/ids.ts": "export const id = 1;\n",
      "app/src/ui/Card.tsx": 'import { id } from "../lib/ids";\nexport const Card = id;\n',
      "app/src/features/feed/Feed.tsx": 'import { Card } from "~/ui/Card";\nimport "./other";\nexport const Feed = Card;\n',
      "app/src/routes/social.index.tsx":
        'import { Feed } from "../features/feed/Feed";\nimport "../server/services/s";\nexport { Feed };\n',
      "app/src/router.tsx": 'import "./routes/social.index";\n',
    });
    expect(checkLayers(root)).toEqual([]);
  });
});
