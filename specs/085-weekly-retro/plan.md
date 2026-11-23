# Plan: 085 weekly-retro

## Approach

factory/retro.mjs computes the numbers part from factory-data metrics, the last four retros and the quarantine list. retro.yml
runs it weekly with no secret, publishes to factory-data, and runs the retro agent (retro skill) behind its preflight.

## Tasks

- T-001 Retro numbers, fixture run, retro skill and retro.yml (AC-001, AC-002, AC-003, AC-004, AC-005): `factory/retro.mjs`, `factory/cli.mjs`, `factory/test/retro.test.mjs`, `factory/test/acceptance-085.test.mjs`, `factory/test/fixtures/metrics/*.jsonl`, `factory/test/fixtures/retros/*.md`, `.claude/skills/retro/SKILL.md`, `.github/workflows/retro.yml`

## Tests

Every AC has a test tagged `// @ac 085/AC-xxx` in `factory/test/acceptance-085.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
