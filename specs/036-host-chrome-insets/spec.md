---
id: "036"
title: The call window keeps clear of the reader's header and side panel (SurfaceHost 1.2 insets)
status: approved
features: [HOST-008]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [host-integration, session]
risk: high
contract_impact: host-minor
---

## Problem

The call window's default place, top right, is also where the reader's header and its connections side panel are. Without
knowing where they are, the window either covers them or sits at a guessed offset that is wrong in some layouts. Social may not
read the reader's markup to find out: it talks to the reader only through the SurfaceHost contract. The contract therefore
needs one optional member that tells the surface which parts of the viewport the reader's own chrome occupies.

## Acceptance criteria

- AC-001 WHEN the pinned host contract is updated THE SYSTEM SHALL carry SurfaceHost 1.2 with an optional
  `ui.chrome: { get(): { top: number; inlineStart: number; inlineEnd: number; bottom: number }; subscribe(cb): Unsubscribe }`
  (CSS pixels the reader's chrome occupies at each edge of the viewport), with the reader commit it came from and its hash
  recorded, and `factory doctor` passing
- AC-002 WHEN the host offers `ui.chrome` THE SYSTEM SHALL place and clamp the call window inside the viewport minus those
  insets, and re-place it whenever `subscribe` fires (for example the side panel opening at the inline end)
- AC-003 WHEN the host is SurfaceHost 1.0 or 1.1 (no `ui.chrome`) THE SYSTEM SHALL use fallback insets (top 64, others 0),
  without an error
- AC-004 WHEN `ui.chrome.get()` returns a value that is not four finite numbers between 0 and the viewport's size, or throws THE
  SYSTEM SHALL use the fallback insets and report `av.error` with kind `chrome_invalid` once per page
- AC-005 WHEN tests and the harness run THE SYSTEM SHALL offer `ui.chrome` on the fake host with insets a test can set, and a
  way to build a 1.1 host without it

## Out of scope

- The reader's side: computing the insets from its header and side panel and notifying on change. That is a Sefaria-Project
  `reader-next` PR (the contract's canonical source is `reader-next/contract/surface-host.v1.ts`) and needs the reader
  owner's agreement.
- Any other contract member.

## Notes for the planner

- Contract rules (PLAN 4.2): a minor version adds optional members only; the surface checks presence, never the minor number
  alone. Types are generated from the schema, never hand-copied; `packages/host-contract/` holds the pinned copy.
- The atlas check fails a PR that adds a host-contract member without an atlas change: HOST-008 covers it.
- Spec 035's geometry functions take the insets as an argument, so this spec only changes where they come from.
