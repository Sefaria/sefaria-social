# Factory

The deterministic half of the software factory (plan sections 5.3–5.5, 5.9, 5.10). Plain Node ESM, no build step:
`npm run factory -- <command>`. How to work with it: `docs/runbooks/working-in-the-factory.md`.

| File              | Command                    | What                                                                                              |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `compile.mjs`     | `compile NNN [--draft]`    | spec + `tasks.yaml` → `workorder.json`; creates planned atlas entries                             |
| `approve.mjs`     | `approve NNN --by <email>` | a human records agreement in `specs/approvals.json`                                               |
| `gate.mjs`        | `gate --base <ref>`        | the CI spec gate                                                                                  |
| `doctor.mjs`      | `doctor [--skip-tests]`    | factory health                                                                                    |
| `prove-red.mjs`   | `prove-red --base <ref>`   | new `@ac` tests must fail on the merge base, on an assertion                                      |
| `atlas.mjs`       | `atlas [--base <ref>]`     | feature atlas checks                                                                              |
| `atlas-build.mjs` | `atlas:build`              | atlas → one HTML page                                                                             |
| `lib/paths.mjs`   |                            | protected, product, housekeeping paths: the one list hooks, gate and doctor share                 |
| `schemas/`        |                            | JSON Schemas: spec frontmatter, `tasks.yaml`, `workorder.json`, `features.json`, `approvals.json` |
| `test/`           | `npm run test:factory`     | every rule's negative test, in fixture git repos (`@guard <module>/<rule>`)                       |

Every rule is listed in its module's exported `RULES`; `doctor` fails when a rule has no test tagged `@guard <module>/<rule>`.
Agent lanes (F2; how to operate them: `docs/runbooks/agent-lanes.md`):

| File                  | Command                             | What                                                                       |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `preflight.mjs`       | `preflight <lane>`                  | run or skip an agent lane, with a notice when credentials are absent       |
| `metrics.mjs`         | `metrics record\|from-run\|publish` | append-only JSON lines on the `factory-data` branch (zero dependencies)    |
| `surfaces.mjs`        | `surfaces --base <ref>`             | QA surfaces from the diff through `surface-map.yaml`                       |
| `qa.mjs`              | `qa-recount <evidence.json>`        | recount agent QA, render the one evidence comment and the failure issues   |
| `test-health.mjs`     | `collection`, `flake`, `quarantine` | nightly: files on disk == files executed; mixed results; `quarantine.yaml` |
| `retro.mjs`           | `retro --metrics <dir>`             | the weekly retro's numbers                                                 |
| `quality-score.mjs`   | `quality-score [--check]`           | generates `docs/QUALITY_SCORE.md`                                          |
| `holdout.mjs`         | `holdout validate\|score\|issues`   | holdout scenario format, satisfaction score, redacted issue bodies         |
| `prompts/`            |                                     | holdout evaluator and judge prompts                                        |
| `surface-map.yaml`    |                                     | path → QA surface                                                          |
| `quarantine.yaml`     |                                     | flaky tests: reason, issue, expiry                                         |
| `test/acceptance-08x` | `npm run test:factory`              | acceptance tests of specs 080–086 (CLI only, so prove-red can run them)    |
