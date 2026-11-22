// `npm run factory -- atlas [--base <ref>]`: the feature atlas checks (plan 5.10). Runs in CI `static`.
// Tests carry `// @feature ID Name` tags; the name must match the atlas entry, so a wrong id is caught by its name.
// With --base, also checks the PR: new routes, API endpoints and host-contract members must come with an atlas change, and a
// feature that becomes `built` gets a CHANGELOG line.
import { FactoryError, changedFiles, git, mergeBase, readAtRef, readText, resolveRef, walk } from "./lib/repo.mjs";
import { isTestFile } from "./lib/paths.mjs";
import { CHANGELOG, FEATURES, FEATURE_ID, listSpecs, loadFeatures, loadSpec } from "./lib/spec.mjs";

/** Rule ids; each has a negative test tagged `@guard atlas/<id>` (doctor checks). */
export const RULES = [
  "schema",
  "unique-ids",
  "tag-known",
  "tag-name",
  "built-has-test",
  "tests-listed",
  "acs-once",
  "new-surface-needs-atlas",
  "changelog",
];

const TAG = /@feature\s+([A-Z]+-\d{3})(?:[ \t]+(.*?))?\s*(?:\*\/)?$/;

/** Every `@feature` tag in the repo's test files: [{ file, line, id, name }]. */
export function scanFeatureTags(root) {
  const tags = [];
  for (const file of walk(root).filter(isTestFile)) {
    const text = readText(root, file) ?? "";
    text.split("\n").forEach((line, i) => {
      if (!/^\s*(\/\/|\*|\/\*)/.test(line)) return; // tags live in comments
      const m = line.match(TAG);
      if (m) tags.push({ file, line: i + 1, id: m[1], name: (m[2] ?? "").trim() });
    });
  }
  return tags;
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function checkAtlas(root, opts = {}) {
  const problems = [];
  const add = (rule, message, fix) => problems.push({ rule, message, fix });
  const { data, problems: schema, missing } = loadFeatures(root);
  if (missing) add("schema", `${FEATURES} is missing`, 'Create it with { "$comment": "…", "features": [] }.');
  for (const p of schema) add("schema", p, "Fix the entry to match factory/schemas/features.schema.json.");
  const features = Array.isArray(data.features) ? data.features : [];
  const byId = new Map();
  for (const f of features) {
    if (byId.has(f.id))
      add("unique-ids", `${f.id} appears twice in ${FEATURES}`, "Ids are never reused; give the second feature a new id.");
    byId.set(f.id, f);
    if (f.id && f.area && f.id.split("-")[0].toLowerCase() !== f.area)
      add(
        "schema",
        `${f.id} has area '${f.area}' but its prefix says '${f.id.split("-")[0].toLowerCase()}'`,
        "Make area match the id prefix.",
      );
  }

  const tags = scanFeatureTags(root);
  for (const t of tags) {
    const f = byId.get(t.id);
    if (!FEATURE_ID.test(t.id) || !f) {
      add(
        "tag-known",
        `${t.file}:${t.line} tags @feature ${t.id}, which is not in ${FEATURES}`,
        "Use an existing id (names are printed next to ids in the atlas page), or add the feature through its spec.",
      );
      continue;
    }
    if (!t.name)
      add("tag-name", `${t.file}:${t.line} tags @feature ${t.id} without its name`, `Write: // @feature ${t.id} ${f.name}`);
    else if (norm(t.name) !== norm(f.name))
      add(
        "tag-name",
        `${t.file}:${t.line} tags @feature ${t.id} '${t.name}', but ${t.id} is '${f.name}'`,
        "Check the id: the name in the tag must match the atlas entry.",
      );
  }

  for (const f of features) {
    const own = tags.filter((t) => t.id === f.id);
    if (["built", "verified"].includes(f.status) && own.length === 0)
      add(
        "built-has-test",
        `${f.id} '${f.name}' is ${f.status} but no test is tagged @feature ${f.id}`,
        `Tag its test: // @feature ${f.id} ${f.name}, or set the status back to 'planned'.`,
      );
    for (const file of f.tests ?? []) {
      if (!own.some((t) => t.file === file))
        add(
          "tests-listed",
          `${f.id} lists test ${file}, which has no @feature ${f.id} tag (or does not exist)`,
          "Fix the path in 'tests', or tag the test.",
        );
    }
    for (const t of own)
      if (!(f.tests ?? []).includes(t.file))
        add(
          "tests-listed",
          `${t.file} is tagged @feature ${f.id} but is not in ${f.id}'s 'tests'`,
          `Add "${t.file}" to ${f.id}.tests in ${FEATURES}.`,
        );
  }

  // Every AC belongs to at most one feature; every AC of a shipped spec belongs to exactly one.
  const acOwner = new Map();
  for (const f of features)
    for (const ac of f.acs ?? []) {
      if (acOwner.has(ac))
        add("acs-once", `${ac} is listed under both ${acOwner.get(ac)} and ${f.id}`, "An AC belongs to exactly one feature.");
      acOwner.set(ac, f.id);
    }
  for (const { id } of listSpecs(root)) {
    let spec;
    try {
      spec = loadSpec(root, id);
    } catch (e) {
      if (e instanceof FactoryError) continue;
      throw e;
    }
    for (const ac of [...acOwner.keys()].filter((a) => a.startsWith(`${id}/`)))
      if (!spec.acs.some((a) => `${id}/${a.id}` === ac))
        add("acs-once", `${acOwner.get(ac)} lists ${ac}, but spec ${id} has no ${ac.slice(4)}`, "Fix the atlas entry's 'acs'.");
    if (spec.frontmatter.status === "shipped")
      for (const a of spec.acs)
        if (!acOwner.has(`${id}/${a.id}`))
          add("acs-once", `spec ${id} is shipped but ${id}/${a.id} is under no feature`, "Add it to the feature it belongs to.");
  }

  if (opts.base) problems.push(...checkAtlasDiff(root, opts.base, opts.head ?? "HEAD", features));
  return { problems, features, tags };
}

/** PR-level checks: new routes / endpoints / host-contract members need an atlas change; newly built features need a CHANGELOG line. */
export function checkAtlasDiff(root, base, head, features) {
  const problems = [];
  const baseSha = resolveRef(root, base);
  const headSha = resolveRef(root, head);
  const mb = mergeBase(root, baseSha, headSha);
  const files = changedFiles(root, baseSha, headSha);
  const changed = new Set(files.map((f) => f.path));
  const atlasTouched = changed.has(FEATURES);
  const items = [];
  for (const f of files) {
    if (f.status !== "A") continue;
    if (/\.(test|spec)\.[tj]sx?$/.test(f.path)) continue;
    if (/^app\/src\/routes\/api\//.test(f.path)) items.push(`API endpoint ${f.path}`);
    else if (/^app\/src\/routes\/.+\.[tj]sx?$/.test(f.path)) items.push(`route ${f.path}`);
  }
  for (const f of files.filter((x) => /^packages\/host-contract\/src\/.+\.[tj]s$/.test(x.path) && !/\.test\./.test(x.path))) {
    const diff = git(root, ["diff", `${mb}...${headSha}`, "--", f.path]);
    for (const line of diff.split("\n"))
      if (/^\+\s*export\s/.test(line) || /^\+\s{2,}[a-zA-Z]\w*\??\s*[:(]/.test(line))
        items.push(`host-contract member in ${f.path}: ${line.slice(1).trim()}`);
  }
  if (items.length && !atlasTouched)
    for (const item of items)
      problems.push({
        rule: "new-surface-needs-atlas",
        message: `this PR adds ${item} without touching ${FEATURES}`,
        fix: "Record the feature it belongs to (or update the entry it changes) in the atlas.",
      });

  if (atlasTouched) {
    let baseFeatures = [];
    try {
      baseFeatures = JSON.parse(readAtRef(root, mb, FEATURES) ?? '{"features":[]}').features ?? [];
    } catch {
      baseFeatures = [];
    }
    const newlyBuilt = features.filter(
      (f) =>
        ["built", "verified"].includes(f.status) &&
        !["built", "verified"].includes(baseFeatures.find((b) => b.id === f.id)?.status),
    );
    const log = readText(root, CHANGELOG) ?? "";
    for (const f of newlyBuilt)
      if (!changed.has(CHANGELOG) || !log.includes(f.id))
        problems.push({
          rule: "changelog",
          message: `${f.id} becomes ${f.status} in this PR but ${CHANGELOG} has no line for it`,
          fix: `Add a line naming ${f.id} to ${CHANGELOG}.`,
        });
  }
  return problems;
}

export function runAtlas(root, args, out) {
  const i = args.indexOf("--base");
  const base = i >= 0 ? args[i + 1] : undefined;
  const { problems, features, tags } = checkAtlas(root, { base });
  if (problems.length) {
    out.err(`atlas: FAIL (${problems.length} problem${problems.length > 1 ? "s" : ""})`);
    for (const p of problems) out.err(`  x [${p.rule}] ${p.message}\n    fix: ${p.fix}`);
    return 1;
  }
  out.log(
    `atlas: PASS (${features.length} feature(s), ${tags.length} tagged test(s)${base ? `, diff against ${base} checked` : ""})`,
  );
  return 0;
}
