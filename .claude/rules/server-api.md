---
paths:
  - "app/src/server/**"
  - "app/src/routes/api/**"
  - "packages/api-client/**"
---

# Server and API

Summary of `docs/PLAN.md` sections 4.1 and 6; the server is built from milestone P2.

- Server code lives in `app/src/server`, imports only `lib` and `server`, and never imports React (architecture test (c)).
- Protect by default: every route requires a verified identity unless it is explicitly public. Never keep a list of protected
  routes.
- Every endpoint that fetches by id checks that the caller may see it.
- Validate every request body, parameter and header with zod before use.
- Every call to another service has connect and read timeouts; a retried write carries an idempotency key.
- The API is described by an OpenAPI document; clients use the generated `packages/api-client`, never hand-written fetches.
- Never log a token, a request body or a header.
