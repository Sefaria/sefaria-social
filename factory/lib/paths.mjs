// The one list of path classes the factory uses. The guard hook (.claude/hooks/guard-paths.mjs), the compiler, the CI gate
// and doctor's CODEOWNERS check all import from here, so a path can never be protected in one place and open in another.
// Plan section 5.6 (protected paths) minus `specs/**`: specs are open to agents; CODEOWNERS makes a human agree to them.
import { matchAny, matchGlob, globBase } from "./glob.mjs";

/** Agents may not edit these outside a `risk: high` work order; CODEOWNERS requires a human owner's approval. */
export const PROTECTED = [
  ".github/**",
  ".claude/**",
  "factory/**",
  "CLAUDE.md",
  "REVIEW.md",
  "app/src/server/auth/**",
  "app/src/server/webhooks/**",
  "app/src/server/db/migrations/**",
  "packages/host-contract/pinned/**",
  "packages/relay/wrangler.toml",
];

/** Written only by `npm run factory -- approve`, run by a human. The guard hook blocks agent edits to it. */
export const APPROVALS_FILE = "specs/approvals.json";

/** Product code: the guard hook requires an active work order whose task globs match the file. */
export const PRODUCT = ["app/**", "packages/**", "harness/**", "e2e/**"];

/** Spec assets. Open to agents; agreement is a human code owner's review recorded by `factory approve`. */
export const SPECS = ["specs/**"];

/**
 * Housekeeping: changes here never need a spec (plan 5.4 step 2). Docs, READMEs, test snapshots, ignore files.
 * Protected paths and specs are checked first, so CLAUDE.md, REVIEW.md, `.claude/**` and spec.md are never housekeeping.
 */
export const HOUSEKEEPING = ["docs/**", "**/*.md", "**/__snapshots__/**", ".gitignore", ".prettierignore", ".gitattributes"];

/** Files whose change counts as a dependency change (never trivial). */
export const DEPENDENCY_FILES = ["package.json", "package-lock.json", "**/package.json"];

/** Where `@feature` and `@ac` tags are looked for. */
export const TEST_GLOBS = [
  "app/**/*.test.{ts,tsx,mjs,js}",
  "packages/**/*.test.{ts,tsx,mjs,js}",
  "harness/**/*.test.{ts,tsx,mjs,js}",
  "e2e/**/*.{spec,test}.{ts,tsx,mjs,js}",
  "test/**/*.test.{ts,tsx,mjs,js}",
  "factory/test/**/*.test.mjs", // the factory's own features (OPS-*) are tested here
];

export const isProtected = (file) => matchAny(PROTECTED, file);
export const isProduct = (file) => matchAny(PRODUCT, file);
export const isSpec = (file) => matchAny(SPECS, file);
export const isHousekeeping = (file) => !isProtected(file) && !isSpec(file) && matchAny(HOUSEKEEPING, file);
export const isDependencyFile = (file) => matchAny(DEPENDENCY_FILES, file);
export const isTestFile = (file) => matchAny(TEST_GLOBS, file);

const PROBE_SUFFIXES = ["", ".ts", ".tsx", ".test.ts", ".mjs", ".json", ".md", ".yaml", ".toml", ".sql", ".yml"];

/** True when some file matched by `taskGlob` could be a protected path (used by `compile`). */
export function globTouchesProtected(taskGlob) {
  const base = globBase(taskGlob);
  for (const p of PROTECTED) {
    if (matchGlob(p, taskGlob)) return p; // the glob text itself is a protected path (a plain file, or inside a dir)
    if (base && matchGlob(p, `${base}/x`)) return p; // the glob lives inside a protected directory
    const pBase = p.endsWith("/**") ? p.slice(0, -3) : p;
    const probes = p.endsWith("/**")
      ? PROBE_SUFFIXES.flatMap((s) => [`${pBase}/probe${s}`, `${pBase}/a/probe${s}`, `${pBase}/a/b/probe${s}`])
      : [pBase];
    if (probes.some((probe) => matchGlob(taskGlob, probe))) return p; // the glob is broader and reaches into it
  }
  return null;
}
