// The architecture rules over the real repository. A failure prints each violation with its file, line and fix.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkClientServerBan, checkHistory, checkLayers, checkServerNoReact, listSourceFiles } from "./rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const messages = (vs: { message: string }[]) => vs.map((v) => v.message);

describe("architecture of this repository", () => {
  it("scans real source files (guards against a scan that silently finds nothing)", () => {
    expect(listSourceFiles(path.join(REPO_ROOT, "app/src")).length).toBeGreaterThan(3);
  });
  it("(a) follows the layer order lib → (server | ui) → features → routes | surface", () => {
    expect(messages(checkLayers(REPO_ROOT))).toEqual([]);
  });
  it("(b) keeps server code and the Start runtime out of surface, features, ui and lib", () => {
    expect(messages(checkClientServerBan(REPO_ROOT))).toEqual([]);
  });
  it("(c) keeps React out of server", () => {
    expect(messages(checkServerNoReact(REPO_ROOT))).toEqual([]);
  });
  it("(d) touches window.history and location only in app/src/surface/host-history.ts (R1)", () => {
    expect(messages(checkHistory(REPO_ROOT))).toEqual([]);
  });
});
