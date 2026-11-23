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

## Added by F2 (agent lanes, metrics, nightly, retro, holdout)

Every agent job skips with a notice until its inputs exist; nothing here blocks a PR. Details: `docs/runbooks/agent-lanes.md`.

- [ ] **Anthropic credential for Actions**, one of: the repository secret `ANTHROPIC_API_KEY` (all lanes), or the repository
      variables `ANTHROPIC_FEDERATION_RULE_ID` and `ANTHROPIC_ORGANIZATION_ID` for OIDC workload identity federation (review, QA,
      retro, holdout; the security review accepts only the API key). Federation setup: register the GitHub issuer, a service
      account and a rule matching `repo:Sefaria/sefaria-social:` in the Claude Console. Added by F2.
- [ ] **Model variables** (optional; default `claude-opus-5-5` everywhere): `REVIEWER_MODEL` (decision D7, keep Opus-class),
      `QA_MODEL`, `SECURITY_REVIEW_MODEL`, `RETRO_MODEL`, `HOLDOUT_MODEL`. Added by F2.
- [ ] **Workflow token may write**: Settings → Actions → General → Workflow permissions must allow `contents: write` when a
      workflow asks for it (jobs request it explicitly; the default stays read). Without it, metrics lines are not recorded (each
      run prints a warning) and `factory-data` is never created. Do **not** create `factory-data` by hand: the first workflow run
      that records metrics creates it. Added by F2.
- [ ] **Label `escaped`** (and `surface:<key>` labels) for escaped defects, read by the nightly quality score. Added by F2.
- [ ] **Holdout repository**, private, for example `Sefaria/sefaria-social-holdout`, with a `scenarios/` folder (format:
      `docs/runbooks/holdout.md`). Set the repository variable `HOLDOUT_REPO` to its `owner/name`. Building agents' credentials
      must not be able to read it. Added by F2 (also listed by F0).
- [ ] **Holdout deploy key**: a read-only deploy key on the holdout repository; its private half as the secret
      `HOLDOUT_DEPLOY_KEY` in this repository. Only `nightly.yml` (and later `release.yml`) read it; doctor enforces that. Added by F2.
- [ ] **Staging URL** for the holdout evaluator: repository variable `STAGING_URL` (needs P5's staging deploy). Added by F2.
- [ ] **First five holdout scenarios** in the holdout repo, written by a human. Five proposals are in the appendix below: move
      them, rewrite them in your own words, then delete the appendix from this repository. Added by F2.
- [ ] **Monthly judge calibration**: a holdout owner labels about 20 recorded trials and records agreement (`holdout.md`).
      Added by F2.
- [ ] **L4b (`e2e-reader.yml`)** after the reader seam (A1) lands: set `READER_IMAGE` (the reader container at the pinned commit)
      and `E2E_READER_ENABLED=true`, then add `merge_group` to its triggers. Added by F2.
- [ ] **Approve specs 080, 081, 083, 084, 085 and 086** (built in the F2 PR) after review. For each NNN run
      `npm run factory -- approve NNN --by YOUR_EMAIL`, then `npm run factory -- compile NNN`, and commit
      `specs/approvals.json` and the work orders. Until then `spec-gate` on the F2 PR fails with "spec NNN not approved", which
      is expected. Spec 082 (test personas) is for P3 to build; approve it before P3 starts. Added by F2.

### Appendix: five proposed holdout scenarios (move to the holdout repository, then delete from here)

These are proposals by the F2 worker for a human to rewrite and own. Once real, they must not live in this repository.

1. **H-001 Visitor opens a shared room link.** Story: a signed-out visitor follows a link to a live room's lobby and wants to know
   what is being learned and how to take part. Rubric: R1 (outcome) the lobby names the text being learned; R2 (state) the page says
   that joining needs signing in and offers sign-in; R3 (navigation) after signing in, the visitor lands back on the same lobby.
2. **H-002 Learner joins and follows.** Story: a signed-in learner joins a room whose host is reading Genesis 1 and expects their
   reader to show the host's place. Rubric: R1 (outcome) the learner's reader shows the host's ref within a few seconds; R2 (state)
   when the host moves to the next chapter the learner's reader follows; R3 (state) the learner's own reader settings (language,
   layout) are unchanged.
3. **H-003 Leaving with Back.** Story: a learner in a room presses the browser Back button expecting to leave the room and return
   to where they were reading before. Rubric: R1 (navigation) Back leaves the room view; R2 (state) the reader shows the place the
   learner was reading before joining; R3 (outcome) the learner is no longer listed as present in the room.
4. **H-004 Refresh keeps the session.** Story: a learner in a room reloads the page and expects to still be in the room at the same
   place. Rubric: R1 (resilience) after reload the room is shown as joined without a new Join press; R2 (state) the reader shows the
   room's current ref; R3 (outcome) the presence list shows the learner once, not twice.
5. **H-005 Hebrew interface.** Story: a learner using the Hebrew interface opens the feed and a room lobby and expects everything to
   read naturally right to left. Rubric: R1 (language) the feed's headings and buttons are in Hebrew; R2 (accessibility) the page
   direction is right to left and focus order follows it; R3 (language) dates and counts are formatted for Hebrew.

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

## Added by P2 (server and identity)

- [ ] **Approve specs 005–008** (`specs/005-…` to `specs/008-…`): review each, then from your own terminal
      `npm run factory -- approve NNN --by <your email>` and `npm run factory -- compile NNN`, and commit
      `specs/approvals.json` and the work orders. Until then `spec-gate` on the P2 PR fails only with "spec NNN not
      approved". Added by P2.
- [ ] **Confirm the acceptance-test pattern for a greenfield server** (decision 0005): tests assert the route is served (or
      the module exists) before loading the harness, so `prove-red` sees an assertion failure on the base. Added by P2.
- [ ] **Production Postgres** for social (provider, size, backups, a `DATABASE_URL` secret), and running
      `npm run db:migrate` before each deploy. Added by P2.
- [ ] **Generate the social token key pair and configure Django** (`SOCIAL_TOKEN_PRIVATE_KEYS`, `SOCIAL_TOKEN_ISSUER`) per
      environment, and set social's `SOCIAL_JWKS_URL` and `SOCIAL_TOKEN_ISSUER` to match exactly (a mismatch fails closed:
      every call 401/503). Added by P2.
- [ ] **Webhook secret**: one random value per environment in both Django's and social's `USER_DELETED_WEBHOOK_SECRET`, and
      Django's `USER_DELETED_WEBHOOK_URLS` set to `<social origin>/api/v1/internal/user-deleted`. Added by P2.
- [ ] **A mint-from-dev-Django contract test**: a token minted by a real dev Django verified by social's `verifyToken` (the
      P2 tests use the contract as written in Sefaria-Project PR #4121, not a live Django). Added by P2.

## Added by P3 (rooms)

- [ ] **Approve specs 009–014 and 082** (082 was written by F2, re-planned and built by P3): review each with its code, then
      run the approve and compile commands for each, and commit. Until then `spec-gate` on the P3 PR fails only with "spec
      NNN not approved" (it also lists P1's 001–004, merged into this branch). Added by P3.
- [ ] **Deploy the relay** (Cloudflare; nothing is automated). Pick the account and a custom domain, add the route to
      `packages/relay/wrangler.toml` (no account id in the file; `CLOUDFLARE_ACCOUNT_ID` comes from the environment), set
      `ALLOWED_ORIGINS` to the reader's origins and `JWKS_URL` and `TOKEN_ISSUER` exactly as the server's, and store the
      internal secret with `wrangler secret put RELAY_INTERNAL_SECRET`. Dry run: `npm run check -w @sefaria-social/relay`.
      Then deploy from `packages/relay` with `npx wrangler deploy`. Add a staging environment block the same way. Added by
      P3.
- [ ] **Server and relay wiring**: the server's `RELAY_INTERNAL_URL` and `RELAY_INTERNAL_SECRET` (the relay's value), and
      `SOCIAL_ALLOWED_ORIGINS` (the reader's origins); the reader's `PUBLIC_SOCIAL_RELAY_ORIGIN` (the relay's wss origin)
      and `PUBLIC_SOCIAL_API_ORIGIN` (the server). Added by P3.
- [ ] **Room roles at the relay** (decision 0008): every member may take the lead today, because the relay sees only the
      Sefaria token, not who owns the room. Decide whether only owners host; that needs a server-issued room ticket or a
      relay call to the server. Added by P3.
- [ ] **Protocol drift check on every re-pin**: run `npm run fixtures -w @sefaria-social/session -- --check <checkout>`
      against a Sefaria-Project checkout. A failing case is a protocol change to agree on. Added by P3.
- [ ] **Enable L4b** (`e2e/reader/`, disabled) after A1 merges: two signed-in reader sessions and a reader image; see
      `e2e/reader/README.md`. Added by P3.
- [ ] **`CLAUDE.md` commands** (protected): add `npm run test:relay`, `npm run relay:dev`, the `qa:*` scripts, and that
      `npm run test:e2e` now builds the Start server and needs Postgres (`E2E_DATABASE_URL`). Added by P3.
- [ ] **Licence of the copied code**: `packages/session` and `packages/relay` start from Sefaria-Project (GPL-3.0);
      confirm it fits the social repo's licence once D1 is decided (decision 0007). Added by P3.

## Added by P4 (feed and cards)

- [ ] **Approve specs 015–018** (`specs/015-feed`, `016-light-cards`, `017-source-text`, `018-enlarge-transition`): review
      each with its code, then run the approve and compile commands for each, and commit. Until then `spec-gate` on the P4
      PR fails only with "spec NNN not approved" (it also lists the specs merged in from P1, P3 and F2). Added by P4.
- [ ] **Decide where cards get text in the reader** (decision 0009): social requests `/api/v3/texts/…` from the reader
      page's own origin. Confirm the reader serves (or proxies) that path in every environment, including local
      development; otherwise propose `sefariaOrigin` in `host.config` for contract v1.1. Added by P4.
- [ ] **Review the visual baselines** in `e2e/feed-visual.spec.ts-snapshots/` (English, Hebrew, dark; darwin and linux).
      They were produced by the P4 worker on the harness, not checked by a designer. Added by P4.
- [ ] **Hebrew strings for the feed** in `app/src/features/shell/strings.ts` (`feed*`, `card*`) were written by the P4
      worker; have a Hebrew speaker review them. Added by P4.

## Added by P5 (release)

- [ ] **Approve specs 019–021** (`specs/019-surface-bundle-budget`, `020-release-pipeline`, `021-server-container`): review
      each with its code, then `npm run factory -- approve NNN --by YOUR_EMAIL` and `npm run factory -- compile NNN`, and
      commit. Until then `spec-gate` on the P5 PR fails only with "spec NNN not approved". Added by P5.
- [ ] **Decide who does the infrastructure work, and when** (plan 9; blocks the first real release). The ordered list is in
      `docs/runbooks/deploy.md`, "Before the first real release". Added by P5.
- [ ] **Asset storage and origin** for the surface (D2 default `social.sefaria.org/surface/`): implement `BucketTarget` in
      `app/scripts/release/storage.ts` for the chosen store, then set the variable `RELEASE_TARGET=bucket:<name>` and the
      secret `RELEASE_STORAGE_CREDENTIALS`. The store must send CORS for the reader's origins. Until then `release.yml`'s
      upload, smoke and promote steps skip with a notice. Added by P5.
- [ ] **Registry, workload identity and namespace** for the server: variables `SERVER_IMAGE_REPOSITORY`,
      `DEPLOY_WORKLOAD_IDENTITY_PROVIDER`, `DEPLOY_SERVICE_ACCOUNT`; then wire the deploy step (`deploy.md`, "Wire the deploy
      step") and adapt `deploy/helm/values.yaml`. The infrastructure repository was not touched. Added by P5.
- [ ] **Smoke-test origins**: variables `SOCIAL_ASSET_BASE_URL` (e.g. `https://social.sefaria.org/surface`) and
      `SOCIAL_API_ORIGIN` (e.g. `https://social.sefaria.org`). Added by P5.
- [ ] **Reader configuration** (reader Helm values): `PUBLIC_SOCIAL_MANIFEST_URL=<asset base>/stable/manifest.json`,
      `PUBLIC_SOCIAL_ORIGINS=<asset origin>`, `PUBLIC_SOCIAL_API_ORIGIN`, `PUBLIC_SOCIAL_RELAY_ORIGIN`,
      `PUBLIC_SOCIAL_ENVIRONMENT`. Added by P5.
- [ ] **When the reader adds a Content-Security-Policy**, list the social asset origin (script and style), the API origin and
      the relay origin (`docs/runbooks/security.md`). Added by P5.
- [ ] **First staging release and rollback**, recorded like `docs/runbooks/rollback-rehearsal-local.md` (plan 8 P5's original
      exit test; only a local rehearsal was possible). Added by P5.
- [ ] **Holdout trials need a staging reset hook** (F2's open problem); P5 did not add one, because there is no staging.
      Added by P5.
- [ ] **SRI in Firefox and Safari**: the integrity checks are proven in Chromium only (A1's e2e and `e2e/release.spec.ts`).
      Run the release e2e with Playwright's firefox and webkit projects once, or check by hand. Added by P5.
