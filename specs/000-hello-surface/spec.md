---
id: "000"
title: Social page shows the surface name and contract version
status: proposed
features: [HOST-000]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed]
risk: normal
contract_impact: none
---

## Problem

The factory needs one small, real feature to prove the whole pipeline (spec, work order, guarded build, gate, atlas) before
product work starts. It is also useful on its own: whoever opens the `/social` placeholder today cannot tell which surface
answered or which SurfaceHost contract version it was built for, which is the first thing to check when the reader and the
surface disagree.

## Acceptance criteria

- AC-001 WHEN anyone opens `/social` THE SYSTEM SHALL show the heading "Sefaria Social" and the line "Surface: social,
  SurfaceHost contract v1.0", taking the surface id and the contract version from one shared constant in `app/src/lib`.

## Out of scope

- The real feed (a later spec replaces this placeholder content).
- Hebrew interface strings and styling; the line is diagnostic text for developers.
- Reading the version from the pinned contract (that arrives with P1's `packages/host-contract`).

## Notes for the planner

- The page is `app/src/features/feed/FeedPage.tsx`, rendered by `app/src/routes/social.index.tsx`.
- The surface id and contract major come from `docs/CONTRACT.md` (`id: "social"`, `contract: 1`); minor is 0.
- The test must render the existing `FeedPage` so it fails on the merge base for an assertion reason (prove-red).
