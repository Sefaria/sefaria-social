# Setup checklist: steps only a human can do

Workers append what they could not do themselves; do not rewrite other entries. Tick an item when it is done and note who did it.
Source for most items: `docs/PLAN.md` section 9.

## Repository settings (needed before merging anything)

- [ ] **Ruleset on `main`** with the `result` status check required (it is the only required check; the job name is `result` in
      `.github/workflows/ci.yml`). Also: one human approval, code owners required on protected paths, no direct pushes, no force
      pushes. Added by F0.
- [ ] **Merge queue** on for `main`. `ci.yml` already triggers on `merge_group`. Added by F0.
- [ ] **Code owners**: name the human owners so `.github/CODEOWNERS` (written in F1) can require them for: specs and acceptance
      files (`specs/**`); `CLAUDE.md`, `REVIEW.md`, `.claude/**`, `factory/**`, `.github/**`; auth and migrations
      (`app/src/server/auth/**`, `app/src/server/webhooks/**`, `app/src/server/db/migrations/**`); the pinned contract and relay
      config. Plan sections 5.6 and 9 item 4. Added by F0.
- [ ] **Actions permissions**: allow GitHub Actions to run in this private repository (CI uses only `actions/checkout` and
      `actions/setup-node`). Added by F0.

## Credentials and secrets

- [ ] **Anthropic credentials for Actions** (agent review, agent QA, retro: F2). OIDC if the organisation has it, otherwise a
      repository secret. Agent jobs skip with a notice until it exists. Plan section 5.8. Added by F0.
- [ ] **Reviewer model** in a repository variable (decision D7, default Opus-class). Added by F0.

## Holdout scenarios (needed at F2)

- [ ] **Private holdout repository** (for example `Sefaria/sefaria-social-holdout`) that the building agents' credentials cannot
      read. Plan section 5.5 L5b and decision D8. Added by F0.
- [ ] **Deploy key** for it, read-only, stored as a secret available only to the nightly and release workflows. Added by F0.
- [ ] **First five holdout scenarios**, written by a human. Added by F0.

## Owners and decisions

- [ ] **Named owners** (plan section 9 item 4): specs and acceptance files; `CLAUDE.md` and the factory; auth and migrations.
      `CLAUDE.md` names its owner once decided. Added by F0.
- [ ] **Licence** (decision D1, default: same as Sefaria-Project, GPL-3.0). F0 did not add a `LICENSE` file; add it or confirm the
      default. Added by F0.
- [ ] Decisions with no default (plan section 9): chat retention, moderation and minors; audio/video provider; profiles and follow
      graph source; who does deployment infrastructure; whether the reader accepts `ctx` and the surface loader. Added by F0.
