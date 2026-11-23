# Plan: 084 nightly

## Approach

factory/test-health.mjs parses Vitest and Playwright JSON reports for the collection check, flake detection and the quarantine
gate; factory/quarantine.yaml holds entries. nightly.yml runs every suite three times and the other nightly jobs, each recording
a metrics line; e2e-reader.yml is written and disabled behind a repository variable.

## Tasks

- T-001 Collection check, flake detection and quarantine (AC-001, AC-002, AC-003, AC-004): `factory/test-health.mjs`, `factory/quarantine.yaml`, `factory/cli.mjs`, `factory/test/test-health.test.mjs`, `factory/test/acceptance-084.test.mjs`
- T-002 nightly.yml, disabled e2e-reader.yml and the Stryker config (AC-001, AC-005): `.github/workflows/nightly.yml`, `.github/workflows/e2e-reader.yml`, `stryker.config.json`, `factory/test/acceptance-084.test.mjs`

## Tests

Every AC has a test tagged `// @ac 084/AC-xxx` in `factory/test/acceptance-084.test.mjs`, driving the factory CLI only, so it
loads on the merge base and fails there on an assertion (prove-red). Guards have negative tests tagged `@guard <module>/<rule>`.
