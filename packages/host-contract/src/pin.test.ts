// L3: the pinned contract is exactly what was pinned from the reader (plan 5.5), and the fake host is typed from it (4.6).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const REPO = path.resolve(PKG, "../..");
const PIN = path.join(PKG, "scripts", "pin.mjs");

const copyPackage = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "host-contract-"));
  cpSync(PKG, dir, { recursive: true, filter: (src) => !src.includes("node_modules") });
  return dir;
};
const runCheck = (dir: string) => spawnSync(process.execPath, [PIN, "--check", "--dir", dir], { encoding: "utf8" });

describe("pinned contract", () => {
  // @feature HOST-001 Pinned SurfaceHost contract with runtime schemas
  // @ac 001/AC-003
  it("passes the hash check as pinned, and fails it with a fix line when a pinned file is edited by hand", () => {
    expect(existsSync(PIN), "packages/host-contract/scripts/pin.mjs exists").toBe(true);
    expect(runCheck(PKG).status).toBe(0);
    const dir = copyPackage();
    const file = path.join(dir, "pinned", "surface-host.v1.ts");
    writeFileSync(file, readFileSync(file, "utf8").replace("requestSignIn(): void;", "requestSignIn(): void;\n    extra?: 1;"));
    const res = runCheck(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/pinned\/surface-host\.v1\.ts does not match the hash .* Fix: /);
  });

  // @feature HOST-002 Fake host for tests and the harness
  // @ac 001/AC-004
  it("stops the fake host compiling when the pinned contract removes or renames a member", () => {
    expect(existsSync(path.join(PKG, "src", "fake-host.ts")), "packages/host-contract/src/fake-host.ts exists").toBe(true);
    const dir = copyPackage();
    const file = path.join(dir, "pinned", "surface-host.v1.ts");
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace("requestSignIn(): void;", "requestLogin(): void;"));
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(REPO, "tsconfig.base.json"),
        compilerOptions: { types: [] },
        include: ["src"],
        exclude: ["src/**/*.test.ts"],
      }),
    );
    symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
    const tsc = spawnSync(process.execPath, [path.join(REPO, "node_modules/typescript/bin/tsc"), "-p", dir, "--noEmit"], {
      encoding: "utf8",
    });
    expect(tsc.stdout.split("\n").filter((l) => /error TS/.test(l) && !/fake-host\.ts/.test(l))).toEqual([]);
    expect(tsc.stdout).toMatch(/src\/fake-host\.ts\(\d+,\d+\): error TS\d+:.*requestSignIn/);
  }, 60_000);
});
