# Plan: 083 metrics-store

## Approach

factory/metrics.mjs (zero dependencies) validates lines and commits them to factory-data from a temporary worktree, refetching
and retrying on a race; a composite action wraps it for workflow steps; ci.yml gains a reporter job after result.
factory/quality-score.mjs renders the table from the surface map, test files, atlas and quarantine list.

## Tasks

- T-001 Metrics writer, composite action and ci.yml reporter job (AC-001, AC-002, AC-003, AC-004, AC-005): `factory/metrics.mjs`, `factory/cli.mjs`, `factory/doctor.mjs`, `factory/test/metrics.test.mjs`, `factory/test/doctor-lanes.test.mjs`, `factory/test/acceptance-083.test.mjs`, `.github/actions/metrics/action.yml`, `.github/workflows/ci.yml`
- T-002 Quality score generator (AC-006): `factory/quality-score.mjs`, `factory/cli.mjs`, `factory/test/quality-score.test.mjs`, `factory/test/acceptance-083.test.mjs`

## Tests

Every AC has a test tagged `// @ac 083/AC-xxx` in `factory/test/acceptance-083.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
