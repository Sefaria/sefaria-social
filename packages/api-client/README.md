# @sefaria-social/api-client

Typed client for the social server's API (plan section 6.2). The surface and features reach the server only through it.

- `openapi.json`: the OpenAPI 3.1 document, generated from `app/src/server/api/contracts.ts`.
- `src/schema.ts`: TypeScript types generated from it by `openapi-typescript`.
- `src/index.ts`: `createApiClient({ baseUrl, getToken, correlationId })`, an `openapi-fetch` client that adds the Bearer
  token and `X-Correlation-Id`.

Both generated files are committed. After changing a contract run `npm run api:generate`; the unit test
`app/src/api.contract.test.ts` fails while they differ, and CI's `api:breaking` step fails on a breaking change unless a spec
in the PR declares `contract_impact: api-major`.
