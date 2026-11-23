# Plan: 080 agent-lanes-skip

## Approach

factory/preflight.mjs decides run/skip per lane from what the workflow passes (whether a secret is set, never its value) and
writes GitHub outputs and a notice. agent-review.yml and security-review.yml each have a preflight job and an agent job gated on
its output. factory doctor gains agent-jobs and workflows checks; ci.yml's static job also runs actionlint.

## Tasks

- T-001 Preflight decides run or skip per lane (AC-001, AC-002, AC-003): `factory/preflight.mjs`, `factory/cli.mjs`, `factory/test/preflight.test.mjs`, `factory/test/acceptance-080.test.mjs`
- T-002 Agent review and security review workflows (AC-003, AC-006): `.github/workflows/agent-review.yml`, `.github/workflows/security-review.yml`, `factory/test/acceptance-080.test.mjs`
- T-003 Doctor checks agent jobs and workflow hygiene; actionlint in static (AC-004, AC-005): `factory/doctor.mjs`, `factory/lib/paths.mjs`, `factory/README.md`, `factory/test/doctor-lanes.test.mjs`, `factory/test/acceptance-080.test.mjs`, `.github/workflows/ci.yml`

## Tests

Every AC has a test tagged `// @ac 080/AC-xxx` in `factory/test/acceptance-080.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
