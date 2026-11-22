---
id: "004"
title: The enlarge and minimise lifecycle is a state machine that refuses illegal moves
status: proposed
features: [SESS-002]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [session]
risk: normal
contract_impact: none
---

## Problem

Enlarging a room or shiur into the reader and minimising it again (R9–R12) passes through several states: a card in a feed,
entering, expanded (following or not), detached, leaving. Ad-hoc flags let impossible combinations happen (expanded without a
context, leaving without a place to return to). Plan 4.3 asks for a discriminated union and an explicit transition table, with
every allowed and every forbidden transition tested, before the rooms specs build on it.

## Acceptance criteria

- AC-001 WHEN an event that the transition table allows arrives THE SYSTEM SHALL move to the state the table defines, and the
  table SHALL cover exactly the states idle, card, entering, expanded, detached, leaving and the events of the lifecycle.
- AC-002 WHEN an event that the table does not allow arrives THE SYSTEM SHALL refuse it with a reason and leave the state
  unchanged.
- AC-003 WHEN the reader reports a context while entering THE SYSTEM SHALL reach expanded only if it is the context being
  entered (R9 step 4).

## Out of scope

- Wiring the machine to the host (navigate, applySnapshot) and the UI: the rooms specs.

## Notes for the planner

- `app/src/features/session/machine.ts` with `TRANSITIONS`, `transition()`, `SESSION_KINDS`, `SESSION_EVENT_TYPES`.
