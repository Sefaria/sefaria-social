# spec.md template

```markdown
---
id: "NNN"
title: <one line, what a user can now do>
status: proposed
features: [AREA-NNN]
owner: <github handle of the human owner>
surfaces: [<keys from factory/surface-map.yaml once it exists>]
risk: normal
contract_impact: none
---

## Problem

Who is stuck, on what, and why it matters. Two to five sentences.

## Acceptance criteria

- AC-001 WHEN <trigger> THE SYSTEM SHALL <observable result>
- AC-002 WHEN … THE SYSTEM SHALL …

## Out of scope

- What this spec deliberately does not do.

## Notes for the planner

- Existing code, constraints, routing rules (R1–R18) or contract members that apply.
```

`id` may be written with or without quotes; the factory reads frontmatter as strings. `status` and the approval live outside
the content hash, so a human's approval survives the status change that `factory approve` makes.
