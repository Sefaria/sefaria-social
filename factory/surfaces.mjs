// `npm run factory -- surfaces --base <ref> [--json]` or `surfaces --files <a> <b> …`: the QA surfaces a change touches.
// Plan 5.5: surfaces under test come from the diff's file paths through the fixed map factory/surface-map.yaml, never from
// the PR description; shared code maps to every surface that imports it. The QA planner and the runner both call this, so the
// runner can re-derive the surfaces itself and log anything the plan missed as a planner gap.
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { FactoryError, changedFiles, readText, resolveRef, walk } from "./lib/repo.mjs";
import { matchAny } from "./lib/glob.mjs";
import { isProduct } from "./lib/paths.mjs";

/** Rule ids; each has a negative test tagged `@guard surfaces/<id>` (doctor checks). */
export const RULES = ["unmapped", "map-schema"];

export const MAP_FILE = "factory/surface-map.yaml";
const KEY = /^[a-z0-9][a-z0-9-]*$/;

export function loadSurfaceMap(root) {
  const text = readText(root, MAP_FILE);
  if (text === null) throw new FactoryError(`${MAP_FILE} is missing`, "Restore it; agent QA derives surfaces from it.");
  let data;
  try {
    data = YAML.parse(text) ?? {};
  } catch (e) {
    throw new FactoryError(`${MAP_FILE} is not valid YAML: ${e.message}`);
  }
  const problems = [];
  const surfaces = data.surfaces ?? {};
  if (typeof surfaces !== "object" || Array.isArray(surfaces) || !Object.keys(surfaces).length)
    problems.push("`surfaces` must map at least one surface key to { description, reach, paths }");
  for (const [k, s] of Object.entries(surfaces)) {
    if (!KEY.test(k)) problems.push(`surface key '${k}' must be lowercase letters, digits and hyphens`);
    if (!s || !Array.isArray(s.paths) || !s.paths.length) problems.push(`surface '${k}' has no paths`);
    if (!s?.description) problems.push(`surface '${k}' has no description`);
    if (!s?.reach) problems.push(`surface '${k}' does not say how a runner reaches it ('reach')`);
  }
  for (const k of ["shared", "ignore"])
    if (data[k] !== undefined && !Array.isArray(data[k])) problems.push(`\`${k}\` must be a list of globs`);
  return { surfaces, shared: data.shared ?? [], ignore: data.ignore ?? [], problems };
}

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolveImport(root, from, spec) {
  let base;
  if (spec.startsWith("~/")) base = path.posix.join("app/src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const e of EXTS) if (existsSync(path.join(root, base + e))) return base + e;
  return null;
}

/** Reverse import graph over app/src, packages and harness: file → files that import it directly. */
export function importers(root) {
  const rev = new Map();
  const files = [...walk(root, "app/src"), ...walk(root, "packages"), ...walk(root, "harness")].filter((f) =>
    /\.(ts|tsx|mjs|js)$/.test(f),
  );
  for (const f of files) {
    const text = readText(root, f) ?? "";
    for (const m of text.matchAll(IMPORT)) {
      const target = resolveImport(root, f, m[1] ?? m[2] ?? m[3]);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target).add(f);
    }
  }
  return rev;
}

/**
 * Derive surfaces for changed files. Returns { surfaces: { key: [reasons] }, unmapped: [file], ignored: [file] }.
 * @param {string} root @param {string[]} files
 */
export function deriveSurfaces(root, files) {
  const map = loadSurfaceMap(root);
  if (map.problems.length) throw new FactoryError(`${MAP_FILE}: ${map.problems.join("; ")}`);
  const out = {};
  const add = (k, why) => (out[k] ??= []).push(why);
  const unmapped = [];
  const ignored = [];
  let rev;
  const surfaceOf = (f) =>
    Object.entries(map.surfaces)
      .filter(([, s]) => matchAny(s.paths, f))
      .map(([k]) => k);
  for (const f of files) {
    const direct = surfaceOf(f);
    if (direct.length) {
      for (const k of direct) add(k, f);
      continue;
    }
    if (matchAny(map.shared, f)) {
      rev ??= importers(root);
      const seen = new Set([f]);
      const queue = [f];
      const hits = new Set();
      while (queue.length) {
        for (const imp of rev.get(queue.shift()) ?? []) {
          if (seen.has(imp)) continue;
          seen.add(imp);
          queue.push(imp);
          for (const k of surfaceOf(imp)) hits.add(k);
        }
      }
      for (const k of hits) add(k, `${f} (shared, imported by ${k})`);
      if (!hits.size) ignored.push(`${f} (shared, no importer yet)`);
      continue;
    }
    if (matchAny(map.ignore, f) || !isProduct(f)) ignored.push(f);
    else unmapped.push(f);
  }
  return { surfaces: out, unmapped, ignored };
}

export function runSurfaces(root, args, out) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let files;
  if (args.includes("--files")) files = args.slice(args.indexOf("--files") + 1).filter((a) => !a.startsWith("--"));
  else {
    const base = get("--base");
    if (!base) {
      out.err("usage: surfaces --base <ref> [--head <ref>] [--json] | surfaces --files <file> …");
      return 2;
    }
    files = changedFiles(root, resolveRef(root, base), resolveRef(root, get("--head") ?? "HEAD"))
      .filter((f) => f.status !== "D")
      .map((f) => f.path);
  }
  const r = deriveSurfaces(root, files);
  if (args.includes("--json")) out.log(JSON.stringify(r, null, 2));
  else {
    const keys = Object.keys(r.surfaces);
    out.log(`surfaces: ${keys.length ? keys.join(", ") : "none"} (${files.length} changed file(s))`);
    for (const k of keys) out.log(`  ${k}: ${r.surfaces[k].join("; ")}`);
  }
  if (r.unmapped.length) {
    out.err(
      `surfaces: FAIL\n  x ${r.unmapped.length} changed product file(s) map to no surface: ${r.unmapped.join(", ")}\n    fix: add each path to a surface (or to 'shared' or 'ignore') in ${MAP_FILE}; a human code owner reviews the change.`,
    );
    return 1;
  }
  return 0;
}
