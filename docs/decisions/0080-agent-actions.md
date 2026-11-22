# 0080. Agent actions: confirmed inputs, and where they differ from the plan

- Status: proposed
- Date: 2026-11-23
- Deciders: milestone F2 worker; a human owner confirms by approving the PR

Numbered 0080 (the F2 spec range) so parallel milestones do not collide on 0003–0010.

## Context

Plan 5.8 marks the `anthropics/claude-code-action` inputs `[CHECK]`, and names `anthropics/claude-code-security-review` for the
security lane. Both were read on 2026-11-23 from their repositories (`README.md`, `action.yml`, and for claude-code-action
`docs/usage.md`, `docs/configuration.md`, `docs/security.md`, `docs/setup.md`, `docs/solutions.md`):

- `gh api repos/anthropics/claude-code-action/releases/latest` → `v1`; newest tag `v1.0.286` (commit
  `acfe7992852970efb4fee683d63d628e3e52df67`).
- `gh api repos/anthropics/claude-code-security-review/tags` → no tags; `main` at `0c6a49f1fa56a1d472575da86a94dbc1edb78eda`
  (2026-02-11).

### claude-code-action v1: what the plan assumed, and what is true

| Plan says                                                               | Current action                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`, `claude_args` with `--max-turns`, `--model`, `--allowedTools` | Confirmed. The old `max_turns`, `model`, `allowed_tools` inputs are deprecated in favour of `claude_args`.                                                                                                                                                                                                                                                                       |
| Authenticate by OIDC if the org has it, otherwise a secret              | Both exist. API key: `anthropic_api_key`. OIDC to the Claude API is **workload identity federation**: `anthropic_federation_rule_id` + `anthropic_organization_id` (+ optional service account and workspace ids), with `id-token: write`. These ids are identifiers, not secrets, so they live in repository variables. A static key, if set, takes precedence over federation. |
| `allowed_bots`                                                          | Exists; empty by default (no bot may trigger). We leave it empty.                                                                                                                                                                                                                                                                                                                |
| (not in plan) forks                                                     | `allow_fork_prs` **defaults to `true`**. We set `"false"` on every agent step, and doctor fails a step without it.                                                                                                                                                                                                                                                               |
| (not in plan) permission mode                                           | The action now defaults to **auto mode**, in which a safety review may allow tool calls outside `--allowedTools`. Because the plan wants a strict minimal tool list, every agent step passes `--permission-mode default` (deny what no rule covers).                                                                                                                             |
| (not in plan) project config from the base                              | The action restores project configuration (`.claude/`, `CLAUDE.md`) from the base ref on PRs. Our review job additionally checks out the base at the workspace root, so `REVIEW.md` and the reviewer definition come from the base, and the PR head goes to `pr-head/` (read-only, `--add-dir`).                                                                                 |
| (not in plan) GitHub token                                              | Without `github_token`, the action uses the Claude GitHub App. We pass the workflow `GITHUB_TOKEN`, so no app install is required; comments appear as `github-actions[bot]`.                                                                                                                                                                                                     |
| (not in plan) inline comments                                           | Review comments use `mcp__github_inline_comment__create_inline_comment` (`confirmed: true`). Classification of unconfirmed inline comments needs an API key; with federation it is skipped.                                                                                                                                                                                      |

### claude-code-security-review

- Inputs: `claude-api-key` (required), `claude-model`, `claudecode-timeout` (minutes, default 20), `comment-pr`,
  `upload-results`, `exclude-directories`, `run-every-commit`, `false-positive-filtering-instructions`,
  `custom-security-scan-instructions`. Outputs: `findings-count`, `results-file`.
- **No OIDC**: only an API key. **No turn limit**: it is capped by `claudecode-timeout` and the job's `timeout-minutes`.
- The README says it is **not hardened against prompt injection** and should review only trusted PRs; the plan's "never on forks"
  matches. The README's default model (Opus 4.1) differs from `action.yml` (no default); we always pass `claude-model`.
- No release tags: pinned to a `main` commit SHA, to be bumped deliberately.

## Decision

1. Pin both actions to full commit SHAs (claude-code-action `v1.0.286`; security review `main@0c6a49f`), not `@v1`/`@main`.
   Doctor's `agent-jobs` check fails an unpinned agent action.
2. Every claude-code-action step sets `prompt`, `--model`, `--max-turns`, `--allowedTools`, `--permission-mode default`,
   `allow_fork_prs: "false"`, `github_token`, and both auth inputs (key or federation, whichever is configured).
3. Every agent job is gated on a `preflight` job running `factory/preflight.mjs`, which skips with a notice when no credential
   exists, on forks, and for bots. The security lane requires the API key specifically.
4. Model defaults: `claude-opus-5-5` for every lane, overridable per lane by repository variables (`REVIEWER_MODEL`, `QA_MODEL`,
   `SECURITY_REVIEW_MODEL`, `RETRO_MODEL`, `HOLDOUT_MODEL`). The reviewer is never downgraded (decision D7).
5. The retro agent does not open PRs (plan 5.9 step 4 allows one): a PR opened with the workflow token triggers no CI, so it
   could never pass `result`. It puts its one proposed edit as a diff in an issue; a human opens the PR.
6. Retros are published to the `factory-data` branch (`retros/`), not committed to `docs/retros/` on main (plan 5.9 step 2),
   because workflow commits go to the data branch (plan 5.8). `docs/retros/` keeps the format and a fixture example.

## Consequences

- Upgrading an action is a deliberate PR that changes the SHA and re-reads its README for new defaults like the two above.
- With federation instead of a key, the security lane stays skipped; the checklist says so.
- Overrides plan 5.8 ("`anthropics/claude-code-action@v1`") and 5.9 (retro PR and `docs/retros/` location) as above.
