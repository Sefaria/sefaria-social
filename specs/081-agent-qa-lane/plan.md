# Plan: 081 agent-qa-lane

## Approach

factory/surface-map.yaml and factory/surfaces.mjs derive surfaces (with a reverse import graph for shared code). factory/qa.mjs
recounts evidence and renders the comment and issues. agent-qa.yml wires planner, runner and skeptic around them; e2e/qa/env.mjs
builds the environment from qa:* scripts when they exist and writes fallback evidence when the runner wrote none.

## Tasks

- T-001 Surface map and derivation (AC-001, AC-002, AC-003): `factory/surface-map.yaml`, `factory/surfaces.mjs`, `factory/cli.mjs`, `factory/doctor.mjs`, `factory/test/surfaces.test.mjs`, `factory/test/doctor-lanes.test.mjs`, `factory/test/acceptance-081.test.mjs`
- T-002 Recount, comment and issue bodies (AC-004, AC-005, AC-006): `factory/qa.mjs`, `factory/cli.mjs`, `factory/test/qa.test.mjs`, `factory/test/acceptance-081.test.mjs`
- T-003 agent-qa workflow, environment builder, skills and agents (AC-006, AC-007): `.github/workflows/agent-qa.yml`, `e2e/qa/env.mjs`, `.claude/skills/qa-plan/SKILL.md`, `.claude/skills/qa-run/SKILL.md`, `.claude/agents/qa-runner.md`, `.claude/agents/skeptic.md`, `factory/test/acceptance-081.test.mjs`

## Tests

Every AC has a test tagged `// @ac 081/AC-xxx` in `factory/test/acceptance-081.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
