#!/usr/bin/env node
// The factory CLI: `npm run factory -- <command>`. Commands: compile, approve, gate, doctor, prove-red, atlas, atlas:build,
// and the agent-lane commands (F2): preflight, metrics, surfaces, qa-recount, collection, flake, quarantine, retro,
// quality-score, holdout.
// Each prints what failed, why, and the command that fixes it; exit code 0 = pass, 1 = fail, 2 = usage error.
import { FactoryError, findRoot } from "./lib/repo.mjs";

const USAGE = `usage: npm run factory -- <command> [args]   (global: --root <dir>)

  compile NNN [--draft]        spec + tasks.yaml -> specs/NNN-*/workorder.json (--draft: unapproved, the gate refuses it)
  approve NNN --by <email>     a human code owner records agreement to the spec (never run by an agent or CI)
  gate --base <ref> [--head <ref>]   the CI spec gate: trailers, lanes, approval, task globs, atlas
  doctor [--skip-tests]        factory health: hooks, guard tests, CI checks, skills, CODEOWNERS, links
  prove-red --base <ref>       new/changed @ac tests must fail on the merge base, on an assertion
  atlas [--base <ref>]         feature atlas checks (tags, names, built => tested; with --base: PR checks)
  atlas:build [--out <file>]   render docs/features/features.json to one HTML page

  preflight <lane>             agent lanes: run or skip with a notice (review|qa|security|retro|holdout)
  metrics record|from-run …    append JSON lines to the factory-data branch (or --local <file>, --dry-run)
  surfaces --base <ref>        QA surfaces a change touches, from factory/surface-map.yaml (--files a b … also works)
  qa-recount <evidence.json>   recount agent QA results; render the evidence comment and issue bodies
  collection <report.json> …   test files on disk == test files executed, per level
  flake <run.json> <run.json> … tests with mixed results across runs
  quarantine [--report <f>]    validate factory/quarantine.yaml; judge a report with quarantined tests not gating
  retro --metrics <dir> …      the weekly retro's numbers (docs/retros/ format)
  quality-score [--check]      generate docs/QUALITY_SCORE.md (or check it is current)
  holdout validate|score|issues …  holdout scenario format, satisfaction score, redacted issue bodies`;

const COMMANDS = {
  compile: async () => (await import("./compile.mjs")).runCompile,
  approve: async () => (await import("./approve.mjs")).runApprove,
  gate: async () => (await import("./gate.mjs")).runGate,
  doctor: async () => (await import("./doctor.mjs")).runDoctor,
  "prove-red": async () => (await import("./prove-red.mjs")).runProveRed,
  atlas: async () => (await import("./atlas.mjs")).runAtlas,
  "atlas:build": async () => (await import("./atlas-build.mjs")).runAtlasBuild,
  preflight: async () => (await import("./preflight.mjs")).runPreflight,
  metrics: async () => (await import("./metrics.mjs")).runMetrics,
  surfaces: async () => (await import("./surfaces.mjs")).runSurfaces,
  "qa-recount": async () => (await import("./qa.mjs")).runQa,
  collection: async () => (await import("./test-health.mjs")).runCollection,
  flake: async () => (await import("./test-health.mjs")).runFlake,
  quarantine: async () => (await import("./test-health.mjs")).runQuarantine,
  retro: async () => (await import("./retro.mjs")).runRetro,
  "quality-score": async () => (await import("./quality-score.mjs")).runQualityScore,
  holdout: async () => (await import("./holdout.mjs")).runHoldout,
};

const out = { log: (s) => console.log(s), err: (s) => console.error(s) };

async function main(argv) {
  const args = [...argv];
  const rootIdx = args.indexOf("--root");
  const root = findRoot(rootIdx >= 0 ? args.splice(rootIdx, 2)[1] : undefined);
  const cmd = args.shift();
  if (!cmd || cmd === "help" || cmd === "--help" || !COMMANDS[cmd]) {
    console.error(cmd && !["help", "--help"].includes(cmd) ? `unknown command '${cmd}'\n\n${USAGE}` : USAGE);
    return 2;
  }
  try {
    return await (
      await COMMANDS[cmd]()
    )(root, args, out);
  } catch (e) {
    if (e instanceof FactoryError) {
      console.error(`${cmd}: FAIL\n  x ${e.message}${e.fix ? `\n    fix: ${e.fix}` : ""}`);
      return 1;
    }
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
