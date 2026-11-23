// The feature atlas checks (plan 5.10). Negative tests tagged @guard atlas/<rule>.
import { describe, expect, it } from "vitest";
import { BUILT_FEATURE, cli, commit, makeRepo, specFiles, write } from "./helpers.mjs";
import { renderAtlas } from "../atlas-build.mjs";

const atlas = (root, ...extra) => cli(root, ["atlas", ...extra]);
const TAGGED =
  "// @feature HOST-001 Hello feature\nimport { it, expect } from 'vitest';\nit('says hello', () => expect('hello').toBe('hello'));\n";
const withFeature = (feature = BUILT_FEATURE(), test = TAGGED) =>
  makeRepo({
    ...specFiles(),
    "docs/features/features.json": { $comment: "atlas", features: [feature] },
    "app/src/hello.test.ts": test,
  });

describe("atlas", () => {
  it("passes a built feature with a tagged test whose name matches", () => {
    const r = atlas(withFeature());
    expect(r.stdout).toContain("atlas: PASS (1 feature(s), 1 tagged test(s))");
    expect(r.code).toBe(0);
  });

  // @guard atlas/schema
  it("refuses an entry that breaks the schema or whose area disagrees with its prefix", () => {
    const r = atlas(withFeature({ ...BUILT_FEATURE(), status: "done", area: "room" }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("/features/0/status must be equal to one of the allowed values");
    expect(r.stderr).toContain("HOST-001 has area 'room' but its prefix says 'host'");
  });

  // @guard atlas/unique-ids
  it("refuses a reused id", () => {
    const root = makeRepo({
      "docs/features/features.json": {
        $comment: "atlas",
        features: [
          { ...BUILT_FEATURE(), status: "planned", tests: [] },
          { ...BUILT_FEATURE(), status: "planned", tests: [], acs: [] },
        ],
      },
    });
    expect(atlas(root).stderr).toContain("HOST-001 appears twice");
  });

  // @guard atlas/tag-known
  it("refuses a test tagged with an id that is not in the atlas", () => {
    const r = atlas(withFeature(BUILT_FEATURE(), `${TAGGED}// @feature ROOM-404 Lost room\n`));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("app/src/hello.test.ts:4 tags @feature ROOM-404, which is not in docs/features/features.json");
  });

  // @guard atlas/tag-name
  it("refuses a tag whose name does not match the entry (a wrong id), and a tag without a name", () => {
    const r = atlas(withFeature(BUILT_FEATURE(), TAGGED.replace("Hello feature", "Goodbye feature") + "// @feature HOST-001\n"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("tags @feature HOST-001 'Goodbye feature', but HOST-001 is 'Hello feature'");
    expect(r.stderr).toContain("tags @feature HOST-001 without its name");
  });

  // @guard atlas/built-has-test
  it("turns red when the @feature tag is removed from a built feature's test", () => {
    const r = atlas(withFeature(BUILT_FEATURE(), TAGGED.replace("// @feature HOST-001 Hello feature\n", "")));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("HOST-001 'Hello feature' is built but no test is tagged @feature HOST-001");
  });

  // @guard atlas/tests-listed
  it("refuses a tagged test missing from the entry's tests, and a listed test without the tag", () => {
    const root = withFeature({ ...BUILT_FEATURE(), tests: ["app/src/other.test.ts"] });
    const r = atlas(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("HOST-001 lists test app/src/other.test.ts, which has no @feature HOST-001 tag");
    expect(r.stderr).toContain("app/src/hello.test.ts is tagged @feature HOST-001 but is not in HOST-001's 'tests'");
  });

  // @guard atlas/acs-once
  it("refuses an AC under two features, an AC its spec lacks, and a shipped spec AC under none", () => {
    const two = { ...BUILT_FEATURE("HOST-002"), name: "Second", status: "planned", tests: [], acs: ["001/AC-001", "001/AC-009"] };
    const root = makeRepo({
      ...specFiles("001", { status: "shipped" }),
      ...specFiles("003", { slug: "three", status: "shipped" }),
      "docs/features/features.json": { $comment: "atlas", features: [{ ...BUILT_FEATURE(), status: "planned", tests: [] }, two] },
    });
    const r = atlas(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("001/AC-001 is listed under both HOST-001 and HOST-002");
    expect(r.stderr).toContain("HOST-002 lists 001/AC-009, but spec 001 has no AC-009");
    expect(r.stderr).toContain("spec 003 is shipped but 003/AC-001 is under no feature");
  });

  // @guard atlas/new-surface-needs-atlas
  it("with --base, refuses a new route or API endpoint added without touching the atlas", () => {
    const root = makeRepo();
    commit(root, {
      "app/src/routes/social.rooms.tsx": "export const Route = 1;\n",
      "app/src/routes/api/v1/rooms.ts": "export const GET = 1;\n",
    });
    const r = atlas(root, "--base", "main");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("this PR adds route app/src/routes/social.rooms.tsx without touching docs/features/features.json");
    expect(r.stderr).toContain("this PR adds API endpoint app/src/routes/api/v1/rooms.ts without touching");
  });

  // @guard atlas/changelog
  it("with --base, refuses a feature that becomes built without a CHANGELOG line", () => {
    const root = makeRepo(specFiles());
    commit(root, {
      "docs/features/features.json": { $comment: "atlas", features: [BUILT_FEATURE()] },
      "app/src/hello.test.ts": TAGGED,
    });
    const r = atlas(root, "--base", "main");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("HOST-001 becomes built in this PR but docs/features/CHANGELOG.md has no line for it");
    commit(root, { "docs/features/CHANGELOG.md": "# Feature changelog\n\n- HOST-001 Hello feature: built.\n" });
    expect(atlas(root, "--base", "main").code).toBe(0);
  });

  it("atlas:build renders every entry, escaped, into one HTML page", () => {
    const root = withFeature({ ...BUILT_FEATURE(), description: "<script>alert(1)</script>" });
    write(root, {});
    const html = renderAtlas(root);
    expect(html.match(/<tr data-area="host" data-status="built">/g)?.length).toBe(1);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    const r = cli(root, ["atlas:build", "--out", "out/atlas.html"]);
    expect(r.stdout).toContain("atlas:build: wrote out/atlas.html");
  });
});
