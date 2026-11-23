---
paths:
  - "app/src/server/**"
  - "packages/relay/**"
  - ".github/**"
---

# Security

Summary of `docs/PLAN.md` sections 1.3, 5.6, 5.8 and 6.1.

- Identity comes from Django as a short-lived RS256 token verified against Django's published key (decision D5). Tokens stay in
  memory; never store one in local storage or a cookie, never log one.
- No secrets, personal data or ticket ids in the repo, fixtures or logs.
- Jobs that need a secret skip with a clear notice when it is absent and are listed in `docs/runbooks/setup-checklist.md`.
- Agent jobs get no deploy credentials, have a time limit and a turn limit, and never run on pull requests from forks.
- Protected paths (plan section 5.6) change only with a human code owner's review: `.github/**`, `.claude/**`, `factory/**`,
  `CLAUDE.md`, `REVIEW.md`, `app/src/server/auth/**`, `app/src/server/webhooks/**`, `app/src/server/db/migrations/**`,
  `packages/host-contract/pinned/**`, `packages/relay/wrangler.toml`.
