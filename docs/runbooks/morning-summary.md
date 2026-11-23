# Morning summary (2026-11-23)

Written by the last overnight worker (P5). A copy is at `~/Sefaria/dev/sefaria-social-notes/MORNING.md`.

## The PR stack, in merge order (Sefaria/sefaria-social; nothing is merged)

1. [#1 F0 bootstrap](https://github.com/Sefaria/sefaria-social/pull/1) → `main`
2. [#3 F1 factory](https://github.com/Sefaria/sefaria-social/pull/3) → `m/f0-bootstrap`
3. Siblings on F1 (any order): [#6 P1 surface](https://github.com/Sefaria/sefaria-social/pull/6),
   [#7 P2 server](https://github.com/Sefaria/sefaria-social/pull/7), [#8 F2 agent lanes](https://github.com/Sefaria/sefaria-social/pull/8)
4. [#9 P3 rooms](https://github.com/Sefaria/sefaria-social/pull/9) → `m/p2-server` (also contains #6, merged in)
5. [#10 P4 feed](https://github.com/Sefaria/sefaria-social/pull/10) → `m/p3-rooms` (also contains #8, merged in)
6. [#11 P5 release](https://github.com/Sefaria/sefaria-social/pull/11) → `m/p4-feed`

**How to merge.** Bottom up, with merge commits (with squash, each next PR shows the squashed commits again). After each merge,
delete the merged branch so GitHub retargets the PRs on top of it to `main`, or retarget by hand
(`gh pr edit <n> -R Sefaria/sefaria-social --base main`). **Or** review everything, retarget only #11 to `main`, squash it, and
close #1–#10.
Trade-off: bottom-up keeps one reviewable PR and history per milestone but takes eight merges; top-only is one merge but one
huge commit, and the other PRs close unmerged.

Closed on purpose: #2, #4, #5 (red-proof PRs that showed the gates fail; their branches are deleted).

## The two Sefaria-Project PRs

- [#4121 Django social token, JWKS, deletion webhook](https://github.com/Sefaria/Sefaria-Project/pull/4121) (base `master`).
  Red only on `Continuous Testing: PyTest` (and `continuous-branch-protection`, which follows it): 816 setup errors "tables can
  have at most 1600 columns" on `powered_by_project` in the shared CI Postgres, plus 2 unrelated `powered_by` failures. Not
  caused by this change; the CI test database needs a reset. Its tests pass locally (103/103).
- [#4122 reader seam](https://github.com/Sefaria/Sefaria-Project/pull/4122) (base `reader-next`): green.

## Why every social PR shows `spec-gate` red

Every spec was written by an agent and stays `proposed` until a human approves it (plan 5.2). So `spec-gate` fails on #3 and
every PR above it with only "spec NNN not approved", and `result` fails because of it. Every other job is green.

Specs per PR: #3: 000 · #6: 001–004 · #7: 005–008 · #8: 080, 081, 083–086 · #9: 009–014, 082 (and 001–004 from #6) ·
#10: 015–018 (and 080–086 from #8) · #11: 019–021. All 29: **000–021 and 080–086.**

To approve, from your own terminal (`approve` refuses inside Claude Code or CI), on the top branch, after reviewing. Put your
own address where it says `<your email>`:

```
cd ~/Sefaria/dev/sefaria-social-wt/p5          # branch m/p5-release, the top of the stack; it has every spec
git pull
for id in 000 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 \
          080 081 082 083 084 085 086; do
  npm run factory -- approve $id --by "<your email>" && npm run factory -- compile $id || break
done
git add specs && git commit -m "chore(specs): approve specs 000-021 and 080-086" && git push
```

Approvals committed on the top branch turn #11 green, but they cover the lower PRs only once the stack is merged up to it. So
either review and approve on the top branch and merge top-only, or approve there and let the next agent session restack
(carry the approval commit down into each branch).

## Decisions waiting for you (each is a `proposed` record or a checklist line)

- **R4 wording**: the plan says "basepath"; the build uses two route trees and no basepath (0003). `.claude/rules/routing.md`
  is protected and still says basepath.
- **0003** two thin route trees; host history uses TanStack's undocumented `createHistory` (pinned by a test).
- **0005** auth in our `bind()` wrapper, not Start middleware; acceptance tests start with a "route served / module exists"
  assertion so they are red on the base (the test pattern; weaker than a behavioural red).
- **0006** in-repo OpenAPI breaking-change rules instead of oasdiff.
- **0007** relay tested through Miniflare (beta) because the Workers Vitest pool needs Vitest 4.
- **0008** room access and leadership: the room id is the invitation; everyone joins as host; anyone can lead.
- **0009** card text comes from `/api/v3/texts` on the reader page's own origin; the feed requires sign-in.
- **0080** agent action pins and overrides (`allow_fork_prs: false`, default permission mode).
- **0010** release layout: the pointer is a rewritten manifest copy, source maps stay private, new `container` CI job.
- **Browser fallback budget**: at most five, each with a removal date (F0's default).
- **Licence (D1)**: no LICENSE file yet; the default is Sefaria-Project's.
- **Infrastructure**: who sets up hosting, registry, namespace and database, and when (plan 9; blocks the first real release).
- **Code owners**: `@Sefaria/sefaria-social-owners` in CODEOWNERS does not exist yet.
- **Holdout**: create the private holdout repo; move the five proposed scenarios out of the setup checklist's appendix.

## What is not verified

- No agent lane (review, QA, security review, retro) has run against a live model: there is no Anthropic credential, so they skip.
- The real-reader lane (`e2e-reader.yml`, L4b) is disabled until #4122 merges; the contract is pinned to its unmerged commit.
- The social server has never verified a token from a live Django (only test keys; A2 checked with PyJWT, not `jose`).
- SRI is proven in Chromium only; Firefox and Safari are unchecked.
- Hebrew strings are unreviewed by a native speaker; the feed's visual baselines were made by an agent, not designed.
- No real release has happened: no asset store, registry or cluster. `release.yml`'s real steps skip with a notice; the bucket
  target is a stub; the deploy step is unwired. The release and rollback were rehearsed locally and in CI
  (`docs/runbooks/rollback-rehearsal-local.md`). The server image was built and run only in CI (local Docker could not pull).
- No staging reset hook for holdout trials.

## Setup checklist

`docs/runbooks/setup-checklist.md` (on the top branch) lists every human step by milestone. P5's infrastructure steps are in
order in `docs/runbooks/deploy.md`, "Before the first real release".

## The duplicate cloud session ("Sefaria Social: build from the plan")

Checked at about 04:05 with `gh pr list -R Sefaria/sefaria-social --state all` and `git ls-remote --heads`: **no PR or branch
from it**. The repo has only PRs #1–#11 (this stack; #2, #4, #5 are closed red proofs) and the branches `main`, `factory-data`
and `m/*` of this stack. It may not have pushed yet: run the two commands again, and stop or archive that session.

## Left behind (yours to keep or remove)

- Worktrees, one per milestone: `~/Sefaria/dev/sefaria-social-wt/{f0,f1,f2,p1,p2,p3,p4,p5}` (after merging:
  `git -C ~/Sefaria/dev/sefaria-social worktree remove <path>`).
- Sefaria-Project worktrees (locked): `.claude/worktrees/agent-af67a307c4adaf463` (A1, #4122) and
  `.claude/worktrees/agent-a591f9215cfc008c9` (A2, #4121; holds an untracked `sefaria/local_settings.py` used for local tests).
- The branch `factory-data` is intended (CI metrics); keep it.
- Stale remote-tracking refs for the deleted red-proof branches in the shared clone: `git -C ~/Sefaria/dev/sefaria-social fetch --prune`.
- Local Postgres databases from tests: `sefaria_social_test`, `sefaria_social_e2e_test` (recreated by the tests; safe to drop).
