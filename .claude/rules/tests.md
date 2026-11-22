---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "test/**"
  - "e2e/**"
---

# Tests

From `docs/PLAN.md` section 5.5. Tags and prove-red are checked by the factory; the nightly checks flakes, collection and the quarantine list.

1. Every acceptance criterion has at least one deterministic test tagged with its id (`// @ac 012/AC-001`).
2. Red before green: a new acceptance test must fail against the merge base, for the right reason (the assertion, not a missing
   import). `factory/prove-red.mjs` checks this from F1.
3. No test without an assertion. No branching inside a test. Compare values; no bare truthiness assertions where a value can be
   compared.
4. Integration tests use real Postgres. Never SQLite, never a mock of social's own database. Fake an outside service by its real
   surface, so a removed method fails the test.
5. Sign-in helpers assert that the session is authenticated (token present and accepted), not that a page navigated.
6. When the behaviour is a DOM change, assert the change. Wait with polling conditions; never fixed sleeps.
7. Playwright's healer may change locators and waits only, never assertions or expected values, and may not skip a test.
8. Flaky tests go into `factory/quarantine.yaml` with a reason, an issue link and an expiry date (at most 30 days); only a human
   removes a gate. `npm run factory -- quarantine` validates it; the nightly fails on an expired entry.
9. Every guard or gate ships with a negative test that injects the fault and expects red (see `test/architecture/`).
10. Vitest projects: `architecture` (`test/architecture/**`, L0) and `unit` (`app/src/**`, `packages/*/src/**`, L1). Every test
    has a time limit (`vitest.config.ts`).
