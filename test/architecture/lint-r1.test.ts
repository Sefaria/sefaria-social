// The R1 lint rule in eslint.config.mjs (the editor-time half of R1; checkHistory is the other half): negative tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: REPO_ROOT });

async function r1Lines(code: string, file: string): Promise<number[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(REPO_ROOT, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.line);
}

const CODE = [
  "export function go() {",
  '  history.pushState({}, "", "/a");',
  '  window.history.replaceState(null, "", "/b");',
  '  location.assign("/c");',
  '  window.location.href = "/d";',
  '  location.href = "/e";',
  "}",
  "",
].join("\n");

describe("R1 lint rule", () => {
  it("reports every history and location write in app/src", async () => {
    expect(await r1Lines(CODE, "app/src/features/room/nav.ts")).toEqual([2, 3, 4, 5, 6]);
  }, 30_000);

  it("allows them in app/src/surface/host-history.ts", async () => {
    expect(await r1Lines(CODE, "app/src/surface/host-history.ts")).toEqual([]);
  }, 30_000);
});
