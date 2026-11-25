---
id: "046"
title: "The reader's two mounts share one call and one room connection, so Join call opens the call window"
status: approved
features: [HOST-009]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [host-integration, call, session]
risk: normal
contract_impact: none
---

## Problem

The reader (reader-next) hands the page mount and the persistent mount two different `SurfaceHost` objects (the page mount's
location stays on the social page while a text is open beside it). Social kept its controllers per host object, so on the
cauldron each existed twice: Join call in the lobby started a call in the page mount's controller while the call window renders
in the persistent mount, whose controller stayed off — the button disappeared and nothing opened; and the lobby and the room
window each opened their own connection to the room, so the viewer appeared twice in "Who is here" (once "away"). The harness
and the tests use one host for both mounts, so none of this showed there.

## Acceptance criteria

- AC-001 WHEN the reader mounts the page and the persistent mount with different host objects THE SYSTEM SHALL use one call
  controller, one room controller, one room-sessions registry, one recording, broadcast and replay controller and one window owner
  for the page, so that Join call pressed in the page mount opens the pre-join step in the persistent mount's call window
- AC-002 WHILE both mounts show the same room THE SYSTEM SHALL hold one connection to it, so the viewer appears once in who is here
- AC-003 WHEN a host was never registered by the entry (one host for both mounts, as in the harness and the tests) THE SYSTEM SHALL
  behave as before

## Out of scope

- Changing the reader's host factory (Sefaria-Project); the surface copes with either.

## Notes for the planner

- `features/host/document-host.ts`: `registerMountHost(host, kind)` from `surface/entry.ts`; `documentHostFor(host)` returns one
  object per page whose parts come from the persistent mount's host once it exists, else the page's. Every `…For(host)` factory
  starts with it.
