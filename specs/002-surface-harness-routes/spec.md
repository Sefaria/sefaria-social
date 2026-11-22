---
id: "002"
title: The social surface mounts in a fake reader page and every R6 page loads and deep-links under /social
status: proposed
features: [HOST-003, HOST-004, HOST-005, HOST-006, HOST-007, ROOM-001, SHIUR-001]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [host, feed, room, shiur, settings]
risk: high
contract_impact: none
---

## Problem

Social is loaded into the reader at runtime as a surface (plan 4.1). Before any real feature, the surface needs: a library build
the reader can load (entry, chunks, one stylesheet, a manifest with integrity hashes), an entry module that mounts into the
reader's elements, a router whose history is the reader's (social never owns the address bar), the page grammar of R6 with
social's own not-found page, and a page that plays the reader so all of this is tested without a reader checkout. The routing
rules R1, R2, R4–R7, R15 and R18 must each be held by a test. Decision record: `docs/decisions/0003-two-builds.md`.

## Acceptance criteria

- AC-001 WHEN the surface is built THE SYSTEM SHALL emit an ES module entry whose default export is the Surface, its chunks,
  exactly one CSS file and a `manifest.json` that the reader's pinned manifest schema accepts, listing every chunk and the
  stylesheet with a matching sha384 integrity hash; and the build SHALL fail if surface code imports `@tanstack/react-start` or
  `app/src/server`.
- AC-002 WHEN the surface router changes page THE SYSTEM SHALL do it through `host.navigate` (push or replace) and build hrefs
  with `host.href`, and WHEN the reader's location changes (Back, Forward) THE SYSTEM SHALL render the page for the new location
  without navigating again (R4).
- AC-003 WHEN the surface is mounted on `/social`, `/social/r/$roomId`, `/social/s/$shiurId` or `/social/settings` with no prior
  navigation (a deep link) THE SYSTEM SHALL render that page, and WHEN it is mounted on any other path under `/social`, or with
  an id that does not match `^[A-Za-z0-9_-]{8,128}$`, THE SYSTEM SHALL render social's own not-found page (R6).
- AC-004 WHEN a social page has search parameters THE SYSTEM SHALL validate them per route, drop unknown ones, and write them
  in the reader's plain `k=v` format (R7).
- AC-005 WHEN social navigates THE SYSTEM SHALL leave `window.history` and `window.location` untouched (R1).
- AC-006 WHEN social renders a link THE SYSTEM SHALL render a real `<a href>` built by the host and hand a plain click to the
  host; a link to a ref SHALL take its href from the reader's workspace commands and navigate with `commands.go` (R15).
- AC-007 WHEN the persistent mount runs and the reader's address has no social `ctx` THE SYSTEM SHALL render nothing, and with
  `ctx=social.room.<id>` it SHALL render a link to that room's page; WHEN a second page mount starts THE SYSTEM SHALL unmount the
  first (R18).
- AC-008 WHEN the Start app's route tree and the surface's route tree are compared THE SYSTEM SHALL find the same five paths,
  all under `/social` (R2).
- AC-009 WHEN the Start app runs standalone THE SYSTEM SHALL serve the same routes under the browser's own history (R5).
- AC-010 WHEN the host is another contract major or lacks members THE SYSTEM SHALL render a "please reload" notice and report
  `contract-mismatch` instead of mounting.
- AC-011 WHEN the built surface is loaded into the harness through its manifest, on a desktop and a phone viewport, in English
  and Hebrew THE SYSTEM SHALL load every R6 page from a deep link with `lang`/`dir` for the interface language, move through
  pages with the browser's Back and Forward, and show the persistent mount's way back into a room from a reader page in a
  social context.
- AC-012 WHEN `/social/r/$roomId` opens with a valid id THE SYSTEM SHALL show the room lobby placeholder naming that room id.
- AC-013 WHEN `/social/s/$shiurId` opens with a valid id THE SYSTEM SHALL show the shiur placeholder naming that shiur id.

## Out of scope

- Real page content (feed, lobby, shiur, settings): each page is a placeholder until its own spec. No mockup for that reason.
- Enlarge and minimise (R8–R14; the rooms specs), `host.back()` (not in contract v1), the real-reader lane L4b.

## Notes for the planner

- Two thin route trees over shared definitions, same full paths, no basepath (decision 0003).
- Tests of modules missing on the merge base load them with `import.meta.glob` so they fail on an assertion (prove-red).
- `.github/workflows/ci.yml` gains the `contract` (L3) and `e2e-harness` (L4a) jobs, hence `risk: high`.
