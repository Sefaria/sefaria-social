# 0006. A small in-repo OpenAPI breaking-change check instead of oasdiff

- Status: proposed
- Date: 2026-11-23
- Deciders: milestone P2 worker; a human owner confirms by approving the PR

## Context

Plan 5.5 (L3) and 6.2 ask CI to fail on a breaking API change without an `api-major` spec, with "a diff tool for OpenAPI
`[CHECK]`". The maintained option is `oasdiff` (a Go binary or Docker image). Using it means downloading a binary or image
in CI at a pinned version, and its negative tests would need Docker in the test runner.

## Decision

`app/src/server/api/breaking.ts` implements the rules this API needs today, each with negative and positive unit tests:
operation removed, new required parameter, new required request property, response property removed or made optional,
response enum widened, and type changed (request: head must accept every base type; response: head may not add types),
recursing into properties and array items. `npm run api:breaking -- --base <sha>` compares the merge base's
`packages/api-client/openapi.json` with the PR's and passes breaking changes only when a spec changed in the PR declares
`contract_impact: api-major`. It runs in the CI `integration` job.

## Consequences

- Not covered yet: `$ref` resolution (contracts are inlined, so none occur), `oneOf`/discriminators, headers, response
  status removal, security scheme changes, format/pattern/length tightening. When the API grows any of these, switch to
  `oasdiff` (pinned) or add the rule with its test.
- The `api-major` exemption trusts the spec's frontmatter; the human agreement on that spec is the real control.
