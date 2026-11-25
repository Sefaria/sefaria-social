# Working in the factory

How a change gets from an idea to a merge in this repo (plan sections 5.1–5.10). Every product change after F1 goes this way.
The commands are `npm run factory -- <command>`; `npm run factory -- help` lists them.

## The pipeline

1. **Spec** (`/shape-spec`): `specs/NNN-slug/spec.md` + `acceptance.feature`. Anyone may write it, an agent included.
2. **Agreement**: a human code owner reviews the spec PR (CODEOWNERS covers `specs/**`) and, after approving, runs in their own
   terminal `npm run factory -- approve NNN --by <their email>`. This writes `specs/approvals.json` with the content hash of
   `spec.md` + `acceptance.feature`. The command refuses bot/agent emails and refuses to run inside an agent session or CI.
3. **Plan** (`/plan-spec NNN`): `plan.md` + `tasks.yaml`.
4. **Compile**: `npm run factory -- compile NNN` writes `workorder.json` (and creates `planned` atlas entries). Before approval,
   `compile NNN --draft` writes a work order marked `"approved": false`: agents may build from it locally, but CI's
   `spec-gate` refuses it.
5. **Build** (`/build-task NNN/T-xxx`): one task, one session, one PR, test first. The skill writes `.factory/active.json`;
   the `guard-paths` hook then allows edits only inside that task's file globs. Commits carry trailers:
   `--trailer "Spec: NNN" --trailer "Task: T-xxx"`.
6. **Verify** (`/verify`): commands and real output in the PR body, ending in `VERDICT: PASS`.
7. **CI**, then a human approves the merge.

A change to an agreed spec is its own PR: edit, human review, re-approve, recompile. Because approval is by hash, any edit to
`spec.md` or `acceptance.feature` makes the approval and the work order stop matching.

## What the gate says, and what to do

`spec-gate` (`factory/gate.mjs`) reads the PR's changed files (merge base…head) and commit trailers from git. Lanes:

| Lane         | When                                                                                                  | Result                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| housekeeping | only `docs/**`, Markdown (not `CLAUDE.md`, `REVIEW.md`, `.claude/**`, specs), snapshots, ignore files | pass                                                                             |
| spec         | only `specs/**` (+ housekeeping)                                                                      | pass after validating the spec; a code owner approves it in review               |
| trivial      | ≤ 30 changed lines, no new file, no protected path, no dependency change, no spec file                | pass with a notice                                                               |
| full         | anything else                                                                                         | needs a spec, an approved work order, and every changed file inside a named task |

Failures and their fixes (the gate prints the same text):

| Gate says                                                                  | Fix                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no 'Spec:' trailer on any commit in this PR`                              | build from a work order (`/build-task`), or `git commit --amend --trailer 'Spec: NNN' --trailer 'Task: T-001'`; no spec yet: `/shape-spec`. Git reads only the last paragraph of a message, so keep the trailers there: a paragraph appended after them hides them |
| `no 'Task:' trailer`                                                       | add `Task: T-xxx` (or `Task: NNN/T-xxx` when several specs are named)                                                                                                                                                                                              |
| `spec NNN does not exist`                                                  | shape it                                                                                                                                                                                                                                                           |
| `spec NNN has no work order` / `workorder.json is stale`                   | `npm run factory -- compile NNN` (after a spec, feature or tasks change)                                                                                                                                                                                           |
| `spec NNN not approved`                                                    | a human code owner reviews and runs `approve NNN --by <email>`, then `compile NNN`; commit both files                                                                                                                                                              |
| `spec NNN is approved but … is still a draft`                              | `npm run factory -- compile NNN` (without `--draft`)                                                                                                                                                                                                               |
| `N changed file(s) are outside the named task(s)`                          | move them to their own PR, or add them to the task's `files` (a planning change) and recompile                                                                                                                                                                     |
| `this PR changes the agreed spec NNN … and product code together`          | split: spec change first, in its own PR                                                                                                                                                                                                                            |
| `task(s) complete AREA-NNN but docs/features/features.json is not updated` | set the entry `built`, list its tagged tests, add a `docs/features/CHANGELOG.md` line                                                                                                                                                                              |

**Automated commit writers.** A writer that appends its own `Co-authored-by:` paragraph after your text hides the trailers, and no message you hand it can reorder that paragraph. End the message with git's scissors line instead:

```
Spec: 084
Task: T-002

# ------------------------ >8 ------------------------
```

Git reads the trailers above the scissors line and ignores the paragraphs below it (`git interpret-trailers --parse` and `%(trailers:only)` both report `Spec:` and `Task:` only), so the appended co-author paragraph no longer hides them. The leading `#` matters: git recognises a scissors line only with the comment character, and the bare `----- >8 -----` form is read as ordinary text.

A new spec may arrive in the same PR as its first build (the owner reviews spec and code together); the gate then needs
the approval recorded in that PR. Changing a spec that was already agreed on the base is what must be split.

The PR that introduced the factory (F1) is the one bootstrap case: when the base has no `factory/gate.mjs`, non-product
files are exempt from task coverage and the gate prints a `bootstrap` notice. Product files are never exempt.

## Spec numbers

| Milestone                                      | Range   |
| ---------------------------------------------- | ------- |
| F1 (the pipeline proof)                        | 000     |
| P1 contract, fake host, harness, routing       | 001–004 |
| P2 server and identity                         | 005–008 |
| P3 rooms                                       | 009–014 |
| P4 feed and cards                              | 015–018 |
| P5 release                                     | 019–021 |
| F2 factory specs (agent lanes, metrics, retro) | 080–089 |

Factory specs touch protected paths (`factory/**`, `.github/**`, `.claude/**`), so they are `risk: high`.

## Local guards (Claude Code hooks, `.claude/settings.json`)

- `guard-paths` (before Edit/Write): blocks protected paths (`factory/lib/paths.mjs`) outside a `risk: high` work order, blocks
  `specs/approvals.json` always, and blocks product code (`app/`, `packages/`, `harness/`, `e2e/`) unless
  `.factory/active.json` names a task whose globs match. Specs are open to agents.
- `post-edit-check` (after Edit/Write): Prettier + ESLint on the one file; never blocks.
- `stop-verify` (on Stop): typecheck, ESLint and related unit tests on changed files; exit 2 keeps the agent working.

The hooks guard the file tools, not shell commands; CI's `spec-gate` is the backstop. Details: `docs/decisions/0002-claude-code-hooks.md`.

## Tests and the atlas

- Tag each acceptance test `// @ac NNN/AC-xxx`. `prove-red` runs new or changed `@ac` tests on the merge base and requires an
  assertion failure there.
- Tag each feature's tests `// @feature AREA-NNN <name exactly as in the atlas>`. `factory atlas` fails on an unknown id, a
  name that does not match, a `built` feature with no tagged test, and (in CI, with `--base`) a new route, API endpoint or
  host-contract member without an atlas change. `npm run atlas:build` renders the atlas to `dist/atlas/index.html`.
- Atlas corrections go through idempotent scripts in `docs/features/tools/`.

## Required checks

- `result` — the only required check; it aggregates `changes`, `static`, `unit`, `build`, `spec-gate` and `prove-red`.

## Factory health

`npm run factory -- doctor` checks: hooks registered ⇔ present; every guard rule has a negative test tagged `@guard <id>` and
those tests pass; required checks exist as jobs; every CI job is aggregated by `result`; skill and agent frontmatter, and no
`$` followed by a digit in a `SKILL.md`; protected paths have a code owner; `CLAUDE.md` ≤ 150 lines; relative doc links
resolve; the pinned contract matches its recorded hash (from P1). CI runs it with `--skip-tests` right after the factory tests.
