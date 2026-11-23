---
name: shape-spec
description: Writes a spec (spec.md + acceptance.feature, planned atlas entries) for one feature as a spec PR, from an interview with a human or from a brief. Use when an idea, request or bug needs agreed acceptance criteria before any code is built. Do not use to change code, to plan tasks (use plan-spec), or to approve a spec — approval is a human code owner's act.
argument-hint: "[NNN-slug] [brief]"
---

# Shape a spec

**Critical rules — read first**

1. You write the spec; a human agrees to it. Never run `npm run factory -- approve`, never edit `specs/approvals.json`.
2. A spec PR contains spec assets only (`specs/NNN-slug/…`, plus docs). No product code in the same PR.
3. Every acceptance criterion is testable and has an id: `- AC-001 WHEN <trigger> THE SYSTEM SHALL <observable result>`.
4. Every AC has at least one Gherkin scenario tagged `@AC-001` in `acceptance.feature`.
5. More than about eight tasks' worth of work means two specs. UI specs add `mockup.html` (tokens only) or a design link.

## Steps

1. Pick the number from your milestone's range (see `docs/runbooks/working-in-the-factory.md`); the slug is kebab-case.
2. Ask (or extract from the brief): the problem, who observes the behaviour, what must be true when done, what is out of scope.
3. Write `specs/NNN-slug/spec.md` from `references/spec-template.md`. Frontmatter is validated by
   `factory/schemas/spec.schema.json`: quote nothing, use `status: proposed`, list every atlas feature id in `features:`
   (prefixes FEED, ROOM, SHIUR, SESS, IDENT, HOST, API, OPS; ids are never reused). `risk: high` for auth, tokens,
   deletion, migrations, the contract, CI, hooks or the factory.
4. Write `specs/NNN-slug/acceptance.feature` from `references/feature-template.md`.
5. Check it compiles structurally once tasks exist (plan-spec does that). Open the PR with the title `spec(NNN): <title>`
   and say in the body: "Needs a human code owner's review and `npm run factory -- approve NNN --by <email>`."
