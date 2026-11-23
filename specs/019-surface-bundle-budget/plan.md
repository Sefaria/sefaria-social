# Plan: 019 surface bundle budget

## Approach

`app/vite.surface.config.ts` sets `rolldownOptions.output.minify: true` and drops annotation and JSDoc comments (licence comments
stay). `app/scripts/release/budget.ts` measures the files the manifest lists (raw and gzip level 9) against
`app/surface-budget.json`; `npm run surface:budget` runs it through the release CLI. ci.yml's `build` job runs it after
`build:surface`.

## Tasks

- T-001 Minified surface build and the budget check (AC-001, AC-002, AC-003): `app/vite.surface.config.ts`,
  `app/surface-budget.json`, `app/scripts/release/budget.ts`, `app/scripts/release/cli.ts`, `app/src/surface/minify.contract.test.ts`,
  `factory/test/acceptance-019.test.mjs`, `package.json`
- T-002 CI runs the budget (AC-004): `.github/workflows/ci.yml`, `factory/test/acceptance-019.test.mjs`

## Tests

AC-001 is a contract test that runs the real surface build. AC-002..AC-004 drive the release CLI and read ci.yml from
`factory/test/acceptance-019.test.mjs`, so they load on the merge base and fail there on an assertion.
