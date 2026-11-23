# 0000. Decision record format

- Status: accepted
- Date: 2026-11-23
- Deciders: bootstrap (milestone F0); a human owner confirms by approving the PR

## Context

The plan (`docs/PLAN.md` section 0) asks that every place where code or current documentation disagrees with the plan, and every
choice the plan leaves open, be written down so the next agent or person does not re-decide it.

## Decision

Each decision is one Markdown file in `docs/decisions/`, named `NNNN-short-slug.md` with a four-digit number that is never reused.
The file has these parts, in this order:

1. Title line: `# NNNN. Title`.
2. A list with `Status` (proposed, accepted, superseded by NNNN, rejected), `Date`, and `Deciders`.
3. `## Context`: the problem and the facts, with sources (a file path, a doc URL, or a command and its output).
4. `## Decision`: what was decided, in a few sentences.
5. `## Consequences`: what changes, what it costs, and what plan text it overrides (quote the section number).

A decision is changed by a new record that supersedes it; the old one keeps its text and gets `Status: superseded by NNNN`.

## Consequences

- Records are short and link to sources instead of copying them.
- Spike S1 writes `0001-two-builds.md`. Each resolved `[CHECK]` item in the plan that turned out different gets a record.
