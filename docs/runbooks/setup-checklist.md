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

## Added by F1 (the factory)

- [ ] **Create the team `@Sefaria/sefaria-social-owners` and name its owners.** `.github/CODEOWNERS` uses it as a placeholder
      for `specs/**` and every protected path (plan 5.6). Until it exists, code-owner review cannot be required. Added by F1.
- [ ] **Require code owner review** in the `main` ruleset once the team exists (CODEOWNERS is in place). Added by F1.
- [ ] **Approve spec 000** (`specs/000-hello-surface/`): review it, then run
      `npm run factory -- approve 000 --by <your email>` and `npm run factory -- compile 000` from your own terminal (the
      command refuses agent sessions and CI), and commit `specs/approvals.json` and the work order. Until then `spec-gate`
      on the F1 PR fails with "spec 000 not approved", which is expected. Added by F1.
- [ ] **Name `CLAUDE.md`'s owner** in the file once the owners are decided (plan 5.7). Added by F1.

## Added by P1 (contract, harness, routing)

- [ ] **Approve specs 001–004** (`specs/001-host-contract`, `002-surface-harness-routes`, `003-ctx-codec`,
      `004-session-machine`): review each with its code, then `npm run factory -- approve NNN --by <your email>` and
      `npm run factory -- compile NNN`, and commit. Until then `spec-gate` on the P1 PR fails only because they await approval.
      Added by P1.
- [ ] **Re-pin the contract after the reader seam merges.** `packages/host-contract/pinned/` is pinned from
      `feat/reader-social-surface` @ `b90e19735d` (Sefaria-Project PR 4122, unmerged). After it merges into `reader-next`, run
      `npm run pin -w @sefaria-social/host-contract -- <reader checkout> <merged commit>` and review the diff. Added by P1.
- [ ] **Decide R4's wording.** Decision `docs/decisions/0003-two-builds.md` drops R4's `basepath: "/social"` (the surface tree
      uses `/social/…` paths instead). `docs/ROUTING.md` notes it; `.claude/rules/routing.md` (protected, verbatim) still says
      basepath. Amend it, or reject the decision. Added by P1.
- [ ] **`CLAUDE.md` commands** (protected): add `npm run build:surface`, `npm run build:harness`, `npm run harness`,
      `npm run test:contract`, and that `npm run test:e2e` now builds and runs the harness journeys. Added by P1.
