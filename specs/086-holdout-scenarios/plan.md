# Plan: 086 holdout-scenarios

## Approach

factory/holdout.mjs validates scenario files, scores trial results and writes redacted issue bodies; the evaluator and judge
prompts live in factory/prompts/; nightly.yml lists scenarios, runs one job per scenario and trial (each a clean runner), and
scores them; an issue template forbids pasting scenario text.

## Tasks

- T-001 Holdout scoring, redaction, prompts, template and nightly wiring (AC-001, AC-002, AC-003, AC-004, AC-005): `factory/holdout.mjs`, `factory/cli.mjs`, `factory/prompts/holdout-evaluator.md`, `factory/prompts/holdout-judge.md`, `factory/test/holdout.test.mjs`, `factory/test/acceptance-086.test.mjs`, `.github/ISSUE_TEMPLATE/holdout-failure.yml`, `.github/workflows/nightly.yml`

## Tests

Every AC has a test tagged `// @ac 086/AC-xxx` in `factory/test/acceptance-086.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
