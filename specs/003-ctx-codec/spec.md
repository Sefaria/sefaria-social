---
id: "003"
title: Social reads and writes its room or shiur context in the reader's reserved ctx parameter
status: approved
features: [SESS-001]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session]
risk: normal
contract_impact: none
---

## Problem

When a learner enlarges a room or shiur, the reader's own URL must say which one (plan 4.4, R11): `ctx=social.room.<id>` or
`ctx=social.shiur.<id>`, so a refresh, a share or another device reconnects from the address alone. Social owns only values
starting with `social.` and must leave every other parameter of a reader URL exactly as the reader wrote it (R3).

## Acceptance criteria

- AC-001 WHEN social encodes a room or shiur context THE SYSTEM SHALL write `social.room.<id>` or `social.shiur.<id>`, valid in
  the reader's ctx grammar for any id matching `^[A-Za-z0-9_-]{8,128}$`, and decode it back to the same context.
- AC-002 WHEN a ctx value is malformed, from another namespace, of an unknown kind, has an invalid id, or is not a string THE
  SYSTEM SHALL treat it as no context.
- AC-003 WHEN social adds or removes its context on a reader URL THE SYSTEM SHALL change only the `ctx` parameter, replace an
  earlier ctx when adding, keep a ctx from another namespace when removing, and keep the path, every other parameter and the
  hash byte for byte.

## Out of scope

- Navigating with the context (enlarge and minimise, the rooms specs); the reader side of `ctx` (reader seam, done).

## Notes for the planner

- `app/src/lib/ctx.ts`, pure; ids from `app/src/lib/ids.ts` (also used by spec 002's routes).
