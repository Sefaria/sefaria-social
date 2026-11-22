import { describe, expect, it } from "vitest";
import { makeTree } from "./fixture";
import { checkHistory, HOST_HISTORY_FILE } from "./rules";

const VIOLATIONS: Record<string, string> = {
  "history.pushState": 'history.pushState({}, "", "/x");',
  "window.history.replaceState": 'window.history.replaceState(null, "", "/x");',
  "location.assign": 'location.assign("/x");',
  "window.location.replace": 'window.location.replace("/x");',
  "location.href =": 'location.href = "/x";',
  "window.location.href =": 'window.location.href = "/x";',
  "window.location =": 'window.location = "/x" as unknown as Location;',
};

describe("(d) R1, no history or location writes: negative tests", () => {
  it.each(Object.entries(VIOLATIONS))("reports %s", (_name, code) => {
    const root = makeTree({ "app/src/features/room/nav.ts": `export function go() {\n  ${code}\n}\n` });
    const vs = checkHistory(root);
    expect(vs.map((v) => [v.rule, v.file, v.line])).toEqual([["history", "app/src/features/room/nav.ts", 2]]);
    expect(vs[0]?.message).toContain("Fix:");
  });

  it("scans packages/session too", () => {
    const root = makeTree({ "packages/session/src/x.ts": 'history.pushState({}, "", "/x");\n' });
    expect(checkHistory(root).map((v) => v.file)).toEqual(["packages/session/src/x.ts"]);
  });

  it("allows the host-bridged history file, and reads of location (no false positives)", () => {
    const root = makeTree({
      [HOST_HISTORY_FILE]: 'history.pushState({}, "", "/x");\nlocation.href = "/y";\n',
      "app/src/lib/read.ts": "export const here = () => location.href + window.location.pathname;\n",
    });
    expect(checkHistory(root)).toEqual([]);
  });
});
