import { describe, expect, it } from "vitest";
import { makeTree } from "./fixture";
import { checkClientServerBan } from "./rules";

describe("(b) client layers never import server code or the Start runtime: negative tests", () => {
  it.each(["surface", "features/room", "ui", "lib"])("reports %s importing app/src/server", (dir) => {
    const depth = dir.split("/").length;
    const up = "../".repeat(depth);
    const root = makeTree({ [`app/src/${dir}/leak.ts`]: `import { db } from "${up}server/db/client";\nexport { db };\n` });
    const vs = checkClientServerBan(root);
    expect(vs.map((v) => [v.rule, v.file, v.line])).toEqual([["client-server-ban", `app/src/${dir}/leak.ts`, 1]]);
    expect(vs[0]?.message).toContain("Fix:");
  });

  it("reports the ~/server alias and @tanstack/react-start and its subpaths", () => {
    const root = makeTree({
      "app/src/ui/a.ts": 'import "~/server/auth/verify";\n',
      "app/src/features/feed/b.ts": 'import { createServerFn } from "@tanstack/react-start";\nexport { createServerFn };\n',
      "app/src/surface/c.ts": 'import { getRequestHeader } from "@tanstack/react-start/server";\nexport { getRequestHeader };\n',
    });
    expect(
      checkClientServerBan(root)
        .map((v) => v.file)
        .sort(),
    ).toEqual(["app/src/features/feed/b.ts", "app/src/surface/c.ts", "app/src/ui/a.ts"]);
  });

  it("allows routes to import server code (no false positives)", () => {
    const root = makeTree({
      "app/src/routes/api.health.ts": 'import "../server/services/health";\nimport "@tanstack/react-start";\n',
    });
    expect(checkClientServerBan(root)).toEqual([]);
  });
});
