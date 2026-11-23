# Plan: 007 rooms API, OpenAPI document and generated client

## Approach

- Endpoint contracts (method, path, access, zod params/body/responses, operation id) in
  `app/src/server/api/contracts.ts`; route files bind a contract to a handler through the 005 wrapper, which validates
  input and output against it.
- `app/src/server/services/rooms.ts`: create (one transaction: display cache upsert, room, owner membership), list (join on
  membership), get/update/delete with one membership lookup each; non-member or missing gives `room.not_found`, member
  but not owner gives `room.forbidden`.
- `app/src/server/api/openapi.ts` builds an OpenAPI 3.1 document from the contracts (`z.toJSONSchema`).
  `npm run api:generate` writes `packages/api-client/openapi.json` and `packages/api-client/src/schema.ts`
  (openapi-typescript). `packages/api-client/src/index.ts` wraps `openapi-fetch` with the Bearer token and correlation id.
- `app/src/server/api/breaking.ts`: the breaking-change rules (removed operation, removed or now-optional response
  property, type change, new required request property or parameter). `npm run api:breaking -- --base <ref>` compares
  with the base's document and honours `contract_impact: api-major` in a spec changed by the PR. Runs in the CI
  `integration` job.

## Tests

- `app/src/api.rooms.int.test.ts` (acceptance, real Postgres): AC-001..005, membership seeded directly where no endpoint
  exists yet (joining is P3).
- `app/src/api.contract.test.ts` (acceptance, unit project): AC-006 compares generated and committed files; AC-007 runs
  the breaking rules on a base/head pair, then the api-major exemption.
- `app/src/server/api/breaking.test.ts`: each rule's negative and positive cases.

## Risks

- A hand-rolled diff is smaller than `oasdiff`; recorded in `docs/decisions/0006-openapi-breaking-check.md`, with the rules
  it does not cover.
