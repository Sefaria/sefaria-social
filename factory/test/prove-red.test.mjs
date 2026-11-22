// prove-red (plan 5.5 rule 2): a new @ac test must fail on the merge base, on an assertion. Tagged @guard prove-red/<rule>.
import { describe, expect, it } from "vitest";
import { cli, commit, linkNodeModules, makeRepo } from "./helpers.mjs";

const VITEST_CONFIG = 'export default { test: { include: ["app/**/*.test.mjs"] } };\n';
const MODULE = "export function greet(name) {\n  return `hi ${name}`;\n}\n";

function repo() {
  const root = makeRepo({ "vitest.config.mjs": VITEST_CONFIG, "app/src/greet.mjs": MODULE });
  linkNodeModules(root);
  return root;
}
const test = (body, imp = "./greet.mjs") =>
  `import { it, expect } from "vitest";\nimport { greet } from "${imp}";\n\n// @ac 001/AC-001\nit("greets warmly", () => {\n  ${body}\n});\n`;

describe("prove-red", () => {
  it("passes when the new @ac test fails on the merge base on an assertion", () => {
    const root = repo();
    commit(root, {
      "app/src/greet.mjs": MODULE.replace("hi ${name}", "hello, ${name}!"),
      "app/src/greet.test.mjs": test('expect(greet("Sara")).toBe("hello, Sara!");'),
    });
    const r = cli(root, ["prove-red", "--base", "main"]);
    expect(r.stdout).toContain("ok app/src/greet.test.mjs › greets warmly (001/AC-001): red on the merge base: AssertionError");
    expect(r.code).toBe(0);
  });

  it("passes with nothing to prove when no @ac test changed", () => {
    const root = repo();
    commit(root, { "app/src/greet.mjs": MODULE.replace("hi", "hey") });
    expect(cli(root, ["prove-red", "--base", "main"]).stdout).toContain("prove-red: PASS (no new or changed @ac tests)");
  });

  // @guard prove-red/red-on-base
  it("refuses an @ac test that already passes on the merge base", () => {
    const root = repo();
    commit(root, { "app/src/greet.test.mjs": test('expect(greet("Sara")).toBe("hi Sara");') });
    const r = cli(root, ["prove-red", "--base", "main"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("passes on the merge base, without the feature; it proves nothing");
  });

  // @guard prove-red/loads-on-base
  it("refuses an @ac test that cannot even import on the merge base", () => {
    const root = repo();
    commit(root, {
      "app/src/wave.mjs": "export const greet = () => 'wave';\n",
      "app/src/wave.test.mjs": test('expect(greet()).toBe("wave");', "./wave.mjs"),
    });
    const r = cli(root, ["prove-red", "--base", "main"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does not load on the merge base");
  });

  // @guard prove-red/right-reason
  it("refuses an @ac test that fails on the merge base for a non-assertion reason", () => {
    const root = repo();
    commit(root, { "app/src/greet.test.mjs": test('const o = null;\n  expect(o.name).toBe(greet("x"));') });
    const r = cli(root, ["prove-red", "--base", "main"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("fails on the merge base for the wrong reason: TypeError");
  });
});
