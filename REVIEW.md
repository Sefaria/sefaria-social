# Review rules

What the review agent (and any reviewer) checks on a pull request. The review agent reads this file from the **base** branch, so a
PR cannot weaken its own review. Agent review is advisory; a human approves every merge. Source: `docs/PLAN.md` section 5.7.

## Severity

| Severity  | Meaning                                  |
| --------- | ---------------------------------------- |
| CRITICAL  | Reported as a blocking recommendation    |
| HIGH      | Reported as a blocking recommendation    |
| MEDIUM    | May merge with a follow-up issue         |
| LOW, INFO | Never block. A doubt is an INFO question |

## Always CRITICAL

- An endpoint that fetches by id without an ownership check.
- Auth that lists protected routes instead of protecting by default.
- A secret in the diff.
- An empty `catch`.
- A test with no assertion.
- A boundary input (request body, snapshot, `ctx` value, location state, host data) used without schema validation.
- A write to `window.history` or `location` outside `app/src/surface/host-history.ts` (routing rule R1).

## Always HIGH

- A missing `await`.
- A cross-service call without connect and read timeouts.
- A retried write without an idempotency key.
- A schema change that breaks a rolling deploy.

## Context expansion

When a signature, type, environment variable or API shape changes, grep every caller and consumer outside the diff, including the
pinned contract (`packages/host-contract/`) and the reader's reference surface.

## Output

- At most ten comments, grouped by root cause.
- Each states: severity, rule, `file:line`, the quoted pattern, a measurable fact, and a concrete fix.
- End with a summary.
- Comment only on changed lines, unless the change breaks unchanged code.

## Downgrades

Tests, generated code, migrations and scripts drop one level, except secrets (a secret is always CRITICAL).
