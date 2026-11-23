# Plan: 082 test-personas

## Approach

For P3, after P2: a test-only server route registered only when SOCIAL_ENV matches the test pattern, guarded again at request
time by the environment name and a constant-time comparison of the secret header; persona definitions without personal data;
qa:seed and qa:reset scripts driven by per-scenario seed files and the schema's table list. The file globs below are F2's best
guess at P2's layout; re-plan them when P2 lands.

## Tasks

- T-001 Persona route, test-only, with the production refusal tests (AC-001, AC-002, AC-003): `app/src/routes/api/test/persona.ts`, `app/src/server/services/test-personas.ts`, `app/src/server/services/test-personas.test.ts`, `app/src/routeTree.gen.ts`, `test/integration/persona-route.test.ts`
- T-002 Idempotent seed and schema-checked reset (AC-004, AC-005): `e2e/qa/seeds/*.json`, `app/src/server/db/qa-seed.ts`, `app/src/server/db/qa-seed.test.ts`, `package.json`

## Tests

P3 writes the tests first, against the server P2 builds; production refusal is tested by environment name and by the production
route table.
