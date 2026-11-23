---
id: "001"
title: Social builds against a pinned copy of the reader's SurfaceHost contract and a fake host typed from it
status: proposed
features: [HOST-001, HOST-002]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [host-integration]
risk: high
contract_impact: none
---

## Problem

Social runs inside the reader page and talks to it only through the SurfaceHost v1 contract (plan 4.2). The contract's
canonical source is in Sefaria-Project (`reader-next/contract/surface-host.v1.ts`); social must build against a copy pinned to
a known reader commit, check at run time everything that crosses it, and test against an in-memory host that behaves like the
reader. If the copy drifts, or the fake host is looser than the real one, social's tests pass while the reader breaks it.

## Acceptance criteria

- AC-001 WHEN a value arrives from the host (the host object itself, a location, a viewer, a ctx value, a reader snapshot)
  THE SYSTEM SHALL validate it with a runtime schema whose output type is proven equal to the pinned contract's type at compile
  time, refusing another contract major, a snapshot that carries `ctx` or points off-site, and malformed values.
- AC-002 WHEN a test or the harness uses the fake host THE SYSTEM SHALL behave like the reader where the surface can observe it:
  a browser-like history (push, replace, back, forward, notifications), refusal and report of off-site navigation, `ctx`
  exposed only when well-formed with change-only notifications, `applySnapshot` that validates and keeps the current `ctx`, a
  short-lived token signed with a test key for a signed-in viewer and `SignedOutError` otherwise, and a recorded sign-in request.
- AC-003 WHEN a pinned contract file differs from the hash recorded when it was pinned from a reader commit THE SYSTEM SHALL
  fail the pinned-contract check with a message naming the file and how to fix it.
- AC-004 WHEN the pinned contract removes or renames a member THE SYSTEM SHALL fail to compile the fake host.

## Out of scope

- Changing the contract (that is reader work, then a new pin).
- The surface, its routes and the harness page (spec 002).
- A JSON Schema of the contract: the reader generates one only for the manifest, since a contract made of functions has none
  (reader seam notes); types come from the pinned `.ts` file.

## Notes for the planner

- Pin from `Sefaria/Sefaria-Project` branch `feat/reader-social-surface` (PR 4122, not merged yet), files under
  `reader-next/contract/`: `surface-host.v1.ts`, `surface-manifest.v1.ts`, `surface-manifest.v1.schema.json`.
- `packages/host-contract/pinned/**` is a protected path, hence `risk: high`.
- Tests for modules that do not exist on the merge base load them with `import.meta.glob` so they fail on an assertion.
