---
paths:
  - "app/src/server/db/**"
---

# Database

Summary of `docs/PLAN.md` sections 6 and 9 (D3: Postgres with Drizzle, the default unless the owner decides otherwise).

- Migrations (`app/src/server/db/migrations/**`) are a protected path and must not break a rolling deploy: add, backfill, then
  remove in a later release.
- Every table holding user data is covered by the user-deletion handler and its walk-the-schema test (plan section 6.3).
- Tests use real Postgres (a service container in CI). Never SQLite, never a mock of social's own database.
