---
id: "020"
title: Release pipeline — immutable versioned assets, a stable manifest pointer, smoke tests and rollback
status: approved
features: [OPS-020]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

The reader loads the social surface from one configured manifest URL (`PUBLIC_SOCIAL_MANIFEST_URL`) and checks every file
against the manifest's integrity hashes. Nothing publishes a release yet: there is no versioned upload, no stable manifest for
the reader to point at, no smoke test before readers see a version, and no way to go back. Plan section 7 asks for all of it,
with rollback being "move the pointer back". The hosting does not exist yet (plan 9, D2: no bucket, domain or credentials), so
the pipeline must run end to end against a local filesystem target and skip the real upload and deploy with a notice until a
human provides them.

## Acceptance criteria

- AC-001 WHEN `release publish` runs on a surface build THE SYSTEM SHALL check every file the manifest lists against its
  integrity hash, upload each file and then the manifest under `v/<version>/` with immutable cache headers, never upload
  source maps, refuse to replace an existing file of that version with different bytes, and treat a re-run with the same bytes
  as done
- AC-002 WHEN `release promote <version>` runs THE SYSTEM SHALL first smoke-test the published version (the manifest validates
  against the reader's pinned schema, its contract major is served, every file read back matches its hash), then write
  `stable/manifest.json` with the same entries pointing into `v/<version>/` and a no-cache header, and keep the previous stable
  version as the last known-good; a version that is not published, fails the smoke test or was rolled back is refused and the
  pointer does not move
- AC-003 WHEN `scripts/rollback` runs with no argument THE SYSTEM SHALL move the stable pointer to the last known-good version
  and mark the version it replaced as rolled back; WITH a version argument it SHALL move to that version if it is a known-good
  one; WHEN there is no known-good version it SHALL refuse and leave the pointer as it was
- AC-004 WHEN `RELEASE_TARGET` is `file:<dir>` THE SYSTEM SHALL use that folder as the storage target; WHEN it is
  `bucket:<name>` THE SYSTEM SHALL refuse with a message that the object-store target is a stub until the hosting exists; WHEN
  it is unset or unknown THE SYSTEM SHALL refuse and say how to set it
- AC-005 WHEN a commit lands on main THE SYSTEM SHALL run `release.yml`: build and budget-check the surface, rehearse publish,
  promote and rollback against a filesystem target, then upload, deploy the server, smoke-test and promote for real, each real
  step skipping with a notice naming the missing secret or variable when it is absent; release runs never cancel each other;
  a manual run can roll back
- AC-006 WHEN two versions are released to a filesystem target served over HTTP and the harness loads the stable manifest the
  way the reader does (origin allowlist, integrity on every file) THE SYSTEM SHALL load the second version, after rollback load
  the first version again, and refuse to load a version whose published file was altered

## Out of scope

- The real object store, CDN, domain, registry and cluster credentials (plan 9; infrastructure is a human task).
- Rolling back the server or the database (the server deploy keeps the previous image for Helm's own rollback; migrations
  are forward-only).
- Resetting a staging environment between holdout trials.

## Notes for the planner

- Paths in the stable manifest are relative to it (`../v/<version>/assets/...`), so the reader's module map sees exactly the
  URLs the entry's own imports resolve to, and SRI keeps working.
- The pointer state (`stable/state.json`: current, known-good list, rolled back list) lives next to the stable manifest in the
  same target, so a rollback needs nothing but the target.
- The e2e uses its own output folder and ports so it can run beside the other harness journeys.
