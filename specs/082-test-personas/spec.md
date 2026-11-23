---
id: "082"
title: Test-only persona sessions and idempotent QA seed and reset
status: approved
features: [IDENT-082, OPS-092]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [identity, api]
risk: high
contract_impact: none
---

## Problem

Agent QA and end-to-end tests must sign in as a known identity without a real Django account, and must start every journey from
known data. A route that issues sessions without a password is dangerous if it can ever be reached in production. Plan 5.5
requires it to exist only in a test environment with a shared secret, to return 403 otherwise, and to be proven to refuse in
production; seeding must be idempotent and reset must leave every table empty. This spec is written by F2 for P3 to build in the
server once P2's server and token verification exist.

## Acceptance criteria

- AC-001 WHEN POST /api/test/persona is called with a known persona, the environment name matches ^test(-|$) and the x-qa-
  persona-secret header equals QA_PERSONA_SECRET THE SYSTEM SHALL return that persona's bearer token and a one-time harness
  sign-in URL, and GET /api/v1/me with the token SHALL return the persona's id
- AC-002 WHEN the environment name does not match the test pattern, or the secret header is missing or wrong, or
  QA_PERSONA_SECRET is unset THE SYSTEM SHALL return 403 and create no session
- AC-003 WHEN the production build is inspected THE SYSTEM SHALL contain no route handler that issues persona sessions, proven
  by a test that enumerates the production routes
- AC-004 WHEN npm run qa:seed runs twice for the same scenario THE SYSTEM SHALL create nothing the second time
- AC-005 WHEN npm run qa:reset runs THE SYSTEM SHALL leave zero rows in every table of the schema, checked against the schema
  itself

## Out of scope

- Real Django sign-in (D5, P2).
- Personas beyond those in e2e/qa/personas.md.

## Notes for the planner

- The contract the QA workflow relies on is in e2e/qa/README.md and e2e/qa/personas.md (ports, scripts, header name).
- Re-plan tasks.yaml against P2's actual route and service layout before building; recompile the work order after.
- Production refusal must be tested twice: by environment name and by build (the route module is not bundled).
