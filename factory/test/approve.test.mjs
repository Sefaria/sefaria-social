// `factory approve`: approval is a human act. Negative tests tagged @guard approve/<rule>.
import { describe, expect, it } from "vitest";
import { cli, humanEnv, makeRepo, read, specFiles, exists } from "./helpers.mjs";
import { contentHash } from "../lib/spec.mjs";

describe("approve", () => {
  it("records {by, sha, at} and sets status approved without changing the content hash", () => {
    const root = makeRepo(specFiles());
    const before = contentHash(read(root, "specs/001-hello/spec.md"), read(root, "specs/001-hello/acceptance.feature"));
    const r = cli(root, ["approve", "001", "--by", "owner@example.org"]);
    expect(r.code).toBe(0);
    const a = JSON.parse(read(root, "specs/approvals.json"))["001"];
    expect([a.by, a.sha]).toEqual(["owner@example.org", before]);
    expect(a.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(read(root, "specs/001-hello/spec.md")).toContain("status: approved");
    expect(contentHash(read(root, "specs/001-hello/spec.md"), read(root, "specs/001-hello/acceptance.feature"))).toBe(before);
  });

  // @guard approve/human-email
  it.each([
    [["approve", "001"], "approve needs --by <email>"],
    [["approve", "001", "--by", ""], "approve needs --by <email>"],
    [["approve", "001", "--by", "not-an-email"], "is not an email address"],
    [["approve", "001", "--by", "claude@anthropic.com"], "looks like a bot, agent or CI identity"],
    [
      ["approve", "001", "--by", "41898282+github-actions[bot]@users.noreply.github.com"],
      "looks like a bot, agent or CI identity",
    ],
    [["approve", "001", "--by", "build-agent@example.org"], "looks like a bot, agent or CI identity"],
  ])("refuses %j", (args, message) => {
    const root = makeRepo(specFiles());
    const r = cli(root, args);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(message);
    expect(exists(root, "specs/approvals.json")).toBe(false);
  });

  // @guard approve/not-agent-session
  it.each(["CLAUDECODE", "GITHUB_ACTIONS", "CI"])("refuses to run when %s is set", (key) => {
    const root = makeRepo(specFiles());
    const r = cli(
      root,
      ["approve", "001", "--by", "owner@example.org"],
      humanEnv({ [key]: key === "CLAUDECODE" ? "1" : "true" }),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`refusing to approve from an agent session or CI (${key} is set)`);
    expect(exists(root, "specs/approvals.json")).toBe(false);
  });

  // @guard approve/spec-valid
  it("refuses to approve an invalid spec", () => {
    const root = makeRepo(specFiles("001", { feature: "no feature line\n" }));
    const bad = specFiles("001", { fm: { owner: undefined } });
    const root2 = makeRepo(bad);
    expect(cli(root2, ["approve", "001", "--by", "owner@example.org"]).stderr).toContain("must have required property 'owner'");
    expect(cli(root, ["approve", "001", "--by", "owner@example.org"]).code).toBe(0); // feature problems are compile's job
  });
});
