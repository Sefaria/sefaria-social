// Acceptance tests for spec 020 (release pipeline). They drive the release CLI and scripts/rollback against filesystem
// targets in temporary folders, and read release.yml, so they load on the merge base and fail there on an assertion.
// AC-006 (the harness loading a release through the stable manifest) is e2e/release.spec.ts.
// @feature OPS-020 Release pipeline with versioned assets, a stable pointer and rollback
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO } from "./helpers.mjs";
import { makeBuild, release, rollbackScript, tempDir } from "./release-fixtures.mjs";

const meta = (root, key) => JSON.parse(readFileSync(path.join(root, ".meta", `${key}.json`), "utf8"));
const stable = (root) => JSON.parse(readFileSync(path.join(root, "stable/manifest.json"), "utf8"));

/** A target with versions published from fresh builds (each version's chunk differs, as real releases do). */
function published(versions) {
  const dir = tempDir();
  const root = path.join(dir, "target");
  const target = `file:${root}`;
  for (const v of versions) {
    makeBuild(path.join(dir, `build-${v}`), v, { chunks: { a: `export const a = "${v}";\n` } });
    const r = release(["publish", "--dir", path.join(dir, `build-${v}`)], { target });
    expect(r.out).toContain(`published ${v}`);
    expect(r.code).toBe(0);
  }
  return { dir, root, target };
}

describe("spec 020: release pipeline", () => {
  // @ac 020/AC-001
  it("publishes every listed file and then the manifest under v/<version>/, immutably, without source maps", () => {
    const dir = tempDir();
    const build = path.join(dir, "build");
    const manifest = makeBuild(build, "2026.11.23-1.abc1234");
    const root = path.join(dir, "target");
    const target = `file:${root}`;
    const first = release(["publish", "--dir", build], { target });
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("4 uploaded, 0 already there");
    const prefix = "v/2026.11.23-1.abc1234/";
    for (const f of [manifest.entry, ...manifest.files.map((x) => x.path), "manifest.json"]) {
      expect(existsSync(path.join(root, prefix, f)), f).toBe(true);
      expect(meta(root, `${prefix}${f}`).cacheControl).toBe("public, max-age=31536000, immutable");
    }
    expect(existsSync(path.join(root, prefix, "assets/surface.e1.js.map"))).toBe(false);
    expect(first.stdout.trim().split("\n").at(-1)).toContain(`${prefix}manifest.json`); // the manifest goes last

    const again = release(["publish", "--dir", build], { target });
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("0 uploaded, 4 already there");

    makeBuild(build, "2026.11.23-1.abc1234", { chunks: { a: "export const a = 2;\n" } });
    const changed = release(["publish", "--dir", build], { target });
    expect(changed.code).toBe(1);
    expect(changed.stderr).toMatch(/already exists with different content\. Published versions are immutable/);
  });

  // @ac 020/AC-001
  it("refuses a build whose file no longer matches its hash, and uploads nothing", () => {
    const dir = tempDir();
    const build = path.join(dir, "build");
    makeBuild(build, "1");
    writeFileSync(path.join(build, "assets/chunk.a.js"), "export const a = 'altered';\n");
    const r = release(["publish", "--dir", build], { target: `file:${path.join(dir, "target")}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("assets/chunk.a.js does not match its integrity hash");
    expect(existsSync(path.join(dir, "target", "v"))).toBe(false);
  });

  // @ac 020/AC-002
  it("promote smoke-tests the version, points stable/manifest.json into its folder, and keeps the previous one as known-good", () => {
    const { root, target } = published(["1", "2"]);
    expect(release(["promote", "1"], { target }).code).toBe(0);
    const r = release(["promote", "2"], { target });
    expect(r.stdout).toContain("stable -> 2 (last known-good: 1)");
    expect(r.code).toBe(0);
    const m = stable(root);
    expect(m.version).toBe("2");
    expect(m.entry).toBe("../v/2/assets/surface.e1.js");
    expect(m.files.map((f) => f.path)).toEqual(["../v/2/assets/chunk.a.js", "../v/2/assets/social.c1.css"]);
    expect(m.css).toEqual(["../v/2/assets/social.c1.css"]);
    const published2 = JSON.parse(readFileSync(path.join(root, "v/2/manifest.json"), "utf8"));
    expect(m.integrity).toBe(published2.integrity);
    expect(meta(root, "stable/manifest.json").cacheControl).toBe("no-cache");
    expect(release(["status"], { target }).stdout).toMatch(/current:\s+2\nknown-good:\s+1\n/);
  });

  // @ac 020/AC-002
  it("promote refuses an unpublished version and a version with an altered file, and the pointer stays", () => {
    const { root, target } = published(["1", "3"]);
    expect(release(["promote", "1"], { target }).code).toBe(0);
    const before = readFileSync(path.join(root, "stable/manifest.json"), "utf8");
    const missing = release(["promote", "9"], { target });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("version 9 is not published");
    writeFileSync(path.join(root, "v/3/assets/chunk.a.js"), "export const a = 'altered';\n");
    const altered = release(["promote", "3"], { target });
    expect(altered.code).toBe(1);
    expect(altered.stderr).toMatch(
      /refusing to promote 3; the smoke test failed:[\s\S]*assets\/chunk\.a\.js does not match its integrity hash/,
    );
    expect(readFileSync(path.join(root, "stable/manifest.json"), "utf8")).toBe(before);
    expect(release(["status"], { target }).stdout).toMatch(/current:\s+1\n/);
  });

  // @ac 020/AC-003
  it("scripts/rollback moves the pointer to the last known-good version, and the rolled-back version is never promoted again", () => {
    const { root, target } = published(["1", "2"]);
    release(["promote", "1"], { target });
    release(["promote", "2"], { target });
    const rb = rollbackScript([], { target });
    expect(rb.out).toContain("rolled back: stable -> 1 (rolled back: 2)");
    expect(rb.code).toBe(0);
    expect(stable(root).entry).toBe("../v/1/assets/surface.e1.js");
    expect(release(["status"], { target }).stdout).toMatch(/current:\s+1\nknown-good:\s+\(none\)\nrolled back:\s+2/);
    const again = release(["promote", "2"], { target });
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("refusing to promote 2: it was rolled back");
    // A named rollback target must be known-good.
    const named = rollbackScript(["7"], { target });
    expect(named.code).toBe(1);
    expect(named.out).toContain("refusing to roll back to 7: it is not a known-good version");
  });

  // @ac 020/AC-003
  it("refuses to roll back when there is no known-good version, leaving the pointer", () => {
    const { root, target } = published(["1"]);
    release(["promote", "1"], { target });
    const before = readFileSync(path.join(root, "stable/manifest.json"), "utf8");
    const rb = rollbackScript([], { target });
    expect(rb.code).toBe(1);
    expect(rb.out).toContain("there is no known-good version to go back to");
    expect(readFileSync(path.join(root, "stable/manifest.json"), "utf8")).toBe(before);
  });

  // @ac 020/AC-004
  it("uses a folder target, refuses the bucket stub, and says how to set RELEASE_TARGET when it is missing", () => {
    const dir = tempDir();
    const folder = release(["status"], { target: `file:${dir}` });
    expect(folder.code).toBe(0);
    expect(folder.stdout).toContain("current:     (none)");
    const bucket = release(["status"], { target: "bucket:social-assets" });
    expect(bucket.code).toBe(2);
    expect(bucket.stderr).toMatch(/RELEASE_TARGET=bucket:social-assets: the object-store target is a stub/);
    const unset = release(["status"], { target: null });
    expect(unset.code).toBe(2);
    expect(unset.stderr).toMatch(/RELEASE_TARGET is not set\. Fix: set RELEASE_TARGET=file:<folder>/);
    const unknown = release(["status"], { target: "s3://x" });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('RELEASE_TARGET "s3://x" is not file:<folder> or bucket:<name>');
  });

  // @ac 020/AC-005
  it("release.yml runs on main and by hand, never cancels, rehearses on a folder, and gates every real step on its configuration", () => {
    const file = path.join(REPO, ".github/workflows/release.yml");
    expect(existsSync(file), ".github/workflows/release.yml exists").toBe(true);
    const wf = YAML.parse(readFileSync(file, "utf8"));
    expect(wf.on.push.branches).toEqual(["main"]);
    expect(wf.on.workflow_dispatch.inputs.rollback_to).toBeDefined();
    expect(wf.concurrency["cancel-in-progress"]).toBe(false);
    expect(wf.permissions).toEqual({ contents: "read" });
    const job = wf.jobs.release;
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    const runs = job.steps.map((s) => `${s.name ?? ""}\n${s.run ?? ""}`);
    const at = (re) => runs.findIndex((r) => re.test(r));
    expect(at(/npm run build:surface/)).toBeGreaterThan(-1);
    expect(at(/npm run surface:budget/)).toBeGreaterThan(at(/npm run build:surface/));
    const rehearsal = runs[at(/^Rehearsal/)];
    expect(rehearsal).toMatch(/RELEASE_TARGET="file:/);
    for (const step of ["publish", "smoke --url", "promote", "scripts/rollback"]) expect(rehearsal).toContain(step);
    // Real steps: each checks its readiness flag and otherwise writes a notice and exits 0.
    for (const [name, flag] of [
      [/^Upload the surface/, "ASSETS_READY"],
      [/^Push the image and deploy/, "DEPLOY_READY"],
      [/^Smoke-test the published version/, "SMOKE_READY"],
      [/^Move the stable pointer/, "ASSETS_READY"],
    ]) {
      const i = at(name);
      expect(i, String(name)).toBeGreaterThan(at(/^Rehearsal/));
      expect(runs[i]).toMatch(new RegExp(`"\\$${flag}" != "true"[\\s\\S]*::notice[\\s\\S]*exit 0`));
    }
    expect(at(/^Upload the surface/)).toBeLessThan(at(/^Smoke-test the published version/));
    expect(at(/^Smoke-test the published version/)).toBeLessThan(at(/^Move the stable pointer/));
    expect(job.env.ASSETS_READY).toContain("secrets.RELEASE_STORAGE_CREDENTIALS != ''");
    expect(wf.jobs.rollback.if).toContain("inputs.rollback_to != ''");
    expect(JSON.stringify(wf.jobs.rollback.steps)).toContain("scripts/rollback");
  });
});
