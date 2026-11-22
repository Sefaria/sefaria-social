// Reading the spec assets: spec.md (frontmatter + sections), acceptance.feature (scenarios and their @AC tags), tasks.yaml,
// specs/approvals.json and docs/features/features.json, each validated against its JSON Schema in factory/schemas/.
import { createHash } from "node:crypto";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import YAML from "yaml";
import { FactoryError, readText, readJson } from "./repo.mjs";

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map();

export const FEATURE_ID = /^(FEED|ROOM|SHIUR|SESS|IDENT|HOST|API|OPS)-\d{3}$/;
export const APPROVALS = "specs/approvals.json";
export const FEATURES = "docs/features/features.json";
export const CHANGELOG = "docs/features/CHANGELOG.md";

/** Validate `data` against factory/schemas/<name>.schema.json; returns a list of readable problems. */
export function schemaProblems(name, data) {
  let validate = validators.get(name);
  if (!validate) {
    const schema = JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));
    validate = ajv.compile(schema);
    validators.set(name, validate);
  }
  if (validate(data)) return [];
  return validate.errors.map((e) => {
    const where = e.instancePath || "(top level)";
    const extra = e.params?.additionalProperty ? ` '${e.params.additionalProperty}'` : "";
    const allowed = e.params?.allowedValues ? ` (allowed: ${e.params.allowedValues.join(", ")})` : "";
    return `${where} ${e.message}${extra}${allowed}`;
  });
}

export function normalizeId(id) {
  const s = String(id).trim();
  if (!/^\d{1,3}$/.test(s)) throw new FactoryError(`'${id}' is not a spec number`, "Spec ids are three digits, e.g. 000 or 012.");
  return s.padStart(3, "0");
}

/** The spec folder for an id: exactly one `specs/NNN-slug/`. */
export function findSpecDir(root, id) {
  const nnn = normalizeId(id);
  const specsDir = path.join(root, "specs");
  const matches = existsSync(specsDir)
    ? readdirSync(specsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith(`${nnn}-`))
        .map((d) => `specs/${d.name}`)
    : [];
  if (matches.length === 0)
    throw new FactoryError(`spec ${nnn} does not exist (no specs/${nnn}-<slug>/ folder)`, "Shape it first: /shape-spec.");
  if (matches.length > 1) throw new FactoryError(`spec ${nnn} has several folders: ${matches.join(", ")}`, "Keep one.");
  return matches[0];
}

/** All spec folders, as [{ id, dir }]. */
export function listSpecs(root) {
  const specsDir = path.join(root, "specs");
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{3}-[a-z0-9-]+$/.test(d.name))
    .map((d) => ({ id: d.name.slice(0, 3), dir: `specs/${d.name}` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
/** Frontmatter fields that do not count toward the content hash: they record the approval, not what was agreed. */
const UNHASHED_FIELDS = /^(status|approved_by|approved_sha):.*$/gm;

const lf = (s) => s.replace(/\r\n/g, "\n");

/**
 * The content hash a human agrees to: sha256 over spec.md (minus the status line) and acceptance.feature.
 * Changing a word of either changes the hash, so an approval or a work order stops matching.
 */
export function contentHash(specText, featureText) {
  const spec = lf(specText).replace(
    FRONTMATTER,
    (m, fm) => `---\n${fm.replace(UNHASHED_FIELDS, "").replace(/\n+/g, "\n").trim()}\n---\n`,
  );
  const h = createHash("sha256");
  h.update("spec.md\0").update(spec).update("\0acceptance.feature\0").update(lf(featureText));
  return `sha256:${h.digest("hex")}`;
}

export function fileHash(text) {
  return `sha256:${createHash("sha256").update(lf(text)).digest("hex")}`;
}

export function parseFrontmatter(text, rel) {
  const m = lf(text).match(FRONTMATTER);
  if (!m)
    throw new FactoryError(
      `${rel} has no YAML frontmatter`,
      "Start spec.md with a '---' frontmatter block (see specs/README.md).",
    );
  let data;
  try {
    // The failsafe schema keeps every scalar a string, so `id: 012` stays "012" instead of becoming the number 12.
    data = YAML.parse(m[1], { schema: "failsafe" }) ?? {};
  } catch (e) {
    throw new FactoryError(`${rel} frontmatter is not valid YAML: ${e.message}`, "Fix the frontmatter.");
  }
  return { data, body: lf(text).slice(m[0].length) };
}

/** `## Heading` sections of a Markdown body: { "Acceptance criteria": "...", ... }. */
export function sections(body) {
  const out = {};
  let current = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1];
      out[current] = "";
    } else if (current) out[current] += `${line}\n`;
  }
  return out;
}

export const REQUIRED_SECTIONS = ["Problem", "Acceptance criteria", "Out of scope", "Notes for the planner"];

/** ACs from the "Acceptance criteria" section: lines `- AC-001 WHEN … THE SYSTEM SHALL …`. */
export function parseAcs(body) {
  const sec = sections(body)["Acceptance criteria"] ?? "";
  const acs = [];
  let last = null;
  for (const line of sec.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(AC-\d{3})\b\s*(.*)$/);
    if (m) {
      last = { id: m[1], text: m[2].trim() };
      acs.push(last);
    } else if (last && /^\s+\S/.test(line))
      last.text = `${last.text} ${line.trim()}`; // a wrapped AC line
    else last = null;
  }
  return acs;
}

/** Scenarios of a Gherkin file with the @AC-xxx tags on the lines above (and Feature-level tags). */
export function parseFeature(text) {
  const scenarios = [];
  let pending = [];
  let featureTags = [];
  let sawFeature = false;
  lf(text)
    .split("\n")
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith("#") || line === "") return;
      if (line.startsWith("@")) {
        pending.push(
          ...line
            .split(/\s+/)
            .filter((t) => t.startsWith("@"))
            .map((t) => t.slice(1)),
        );
        return;
      }
      if (/^Feature:/.test(line)) {
        featureTags = pending;
        pending = [];
        sawFeature = true;
        return;
      }
      const m = line.match(/^(Scenario|Scenario Outline|Example|Scenario Template):\s*(.*)$/);
      if (m) {
        const tags = [...featureTags, ...pending];
        scenarios.push({ name: m[2], line: i + 1, tags, acs: tags.filter((t) => /^AC-\d{3}$/.test(t)) });
        pending = [];
        return;
      }
      if (!/^(Examples|Background|Rule):/.test(line)) pending = [];
    });
  return { sawFeature, scenarios };
}

/** Load and validate one spec. Throws FactoryError on a structural problem; returns everything compile and gate need. */
export function loadSpec(root, id) {
  const dir = findSpecDir(root, id);
  const nnn = normalizeId(id);
  const specRel = `${dir}/spec.md`;
  const featureRel = `${dir}/acceptance.feature`;
  const specText = readText(root, specRel);
  if (specText === null) throw new FactoryError(`${specRel} is missing`, "Write it with /shape-spec.");
  const featureText = readText(root, featureRel);
  if (featureText === null) throw new FactoryError(`${featureRel} is missing`, "Write the Gherkin scenarios with /shape-spec.");
  const { data, body } = parseFrontmatter(specText, specRel);
  const problems = schemaProblems("spec", data).map((p) => `${specRel} frontmatter ${p}`);
  if (data.id !== undefined && data.id !== nnn) problems.push(`${specRel} says id '${data.id}' but its folder is ${dir}`);
  const secs = sections(body);
  for (const s of REQUIRED_SECTIONS) if (!(s in secs)) problems.push(`${specRel} has no '## ${s}' section`);
  const acs = parseAcs(body);
  if (acs.length === 0) problems.push(`${specRel} lists no acceptance criteria ('- AC-001 WHEN … THE SYSTEM SHALL …')`);
  const seen = new Set();
  for (const ac of acs) {
    if (seen.has(ac.id)) problems.push(`${specRel} lists ${ac.id} twice`);
    seen.add(ac.id);
  }
  return {
    id: nnn,
    dir,
    specRel,
    featureRel,
    frontmatter: data,
    acs,
    feature: parseFeature(featureText),
    sha: contentHash(specText, featureText),
    featureSha: fileHash(featureText),
    problems,
  };
}

export function loadTasks(root, dir) {
  const rel = `${dir}/tasks.yaml`;
  const text = readText(root, rel);
  if (text === null) throw new FactoryError(`${rel} is missing`, `Plan the spec first: /plan-spec ${dir.slice(6, 9)}.`);
  let tasks;
  try {
    tasks = YAML.parse(text);
  } catch (e) {
    throw new FactoryError(`${rel} is not valid YAML: ${e.message}`, `Fix ${rel}.`);
  }
  return { rel, tasks, problems: schemaProblems("tasks", tasks).map((p) => `${rel} ${p}`) };
}

export function loadApprovals(root) {
  const data = readJson(root, APPROVALS, {});
  const problems = schemaProblems("approvals", data).map((p) => `${APPROVALS} ${p}`);
  return { data, problems };
}

export function loadFeatures(root) {
  const data = readJson(root, FEATURES, null);
  if (data === null) return { data: { features: [] }, problems: [], missing: true };
  return { data, problems: schemaProblems("features", data).map((p) => `${FEATURES} ${p}`), missing: false };
}

/** Is spec `spec` approved at the current content? Returns { ok, reason }. */
export function approvalState(approvals, spec) {
  const entry = approvals[spec.id];
  if (!entry) return { ok: false, reason: `specs/approvals.json has no entry for ${spec.id}` };
  if (entry.sha !== spec.sha)
    return {
      ok: false,
      reason: `its approval (by ${entry.by}) is for different content; the spec or feature file changed since`,
    };
  return { ok: true, entry };
}

/** Patterns an approver's email must not match: bots, CI identities and agents cannot agree to a spec. */
export const NON_HUMAN_EMAIL =
  /(\[bot\]|(^|[^a-z])bot([^a-z]|$)|bots?@|noreply|no-reply|github-actions|actions@github|claude|anthropic|agent|automation|^ci@|copilot|dependabot|renovate)/i;
