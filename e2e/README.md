# End-to-end tests

L4a (plan 5.5): Playwright journeys on the harness (`harness/`), projects `desktop` and `phone`, each journey in English and
Hebrew. `npm run test:e2e` builds the surface and the harness, then serves them with `harness/serve.mjs` (port 3300). The
real-reader lane (L4b) is a later milestone. Playwright tests are not run by `prove-red` (it runs Vitest only).
