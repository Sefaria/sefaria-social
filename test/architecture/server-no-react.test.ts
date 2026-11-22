import { describe, expect, it } from "vitest";
import { makeTree } from "./fixture";
import { checkServerNoReact } from "./rules";

describe("(c) server never imports React: negative tests", () => {
  it.each(["react", "react-dom/server", "react/jsx-runtime", "@tanstack/react-router"])("reports server importing %s", (pkg) => {
    const root = makeTree({ "app/src/server/services/render.ts": `import * as x from "${pkg}";\nexport { x };\n` });
    const vs = checkServerNoReact(root);
    expect(vs.map((v) => [v.rule, v.file, v.line])).toEqual([["server-no-react", "app/src/server/services/render.ts", 1]]);
    expect(vs[0]?.message).toContain("Fix:");
  });

  it("reports a .tsx file under server", () => {
    const root = makeTree({ "app/src/server/services/Page.tsx": "export const n = 1;\n" });
    expect(checkServerNoReact(root).map((v) => v.file)).toEqual(["app/src/server/services/Page.tsx"]);
  });

  it("allows the Start server APIs in server (no false positives)", () => {
    const root = makeTree({
      "app/src/server/auth/headers.ts":
        'import { getRequestHeader } from "@tanstack/react-start/server";\nexport { getRequestHeader };\n',
    });
    expect(checkServerNoReact(root)).toEqual([]);
  });
});
