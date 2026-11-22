---
id: "081"
title: Agent QA tests the surfaces a pull request touches and reports one recount
status: proposed
features: [OPS-082, OPS-083, OPS-084]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Deterministic tests prove what their authors thought of. Plan 5.5 adds an agent QA run per pull request: a planner, a separate
runner that signs in as personas and drives a browser, and a skeptic. It is only worth its cost if its scope comes from the diff
(not the PR description), if a retry or an unreachable surface can never be reported as a pass, and if the counting is done by
code rather than by the agent being judged.

## Acceptance criteria

- AC-001 WHEN the changed files of a pull request are given THE SYSTEM SHALL map them to surfaces through factory/surface-
  map.yaml, mapping shared code to every surface whose files import it and ignoring docs, specs and the factory
- AC-002 WHEN a changed product file maps to no surface THE SYSTEM SHALL fail the derivation, naming the file and how to add it
  to the map
- AC-003 WHEN a spec or an atlas entry names a surface that is not in the surface map THE SYSTEM SHALL fail factory doctor with
  rule surface-map
- AC-004 WHEN the QA runner's evidence is recounted THE SYSTEM SHALL report a retry after a failure as failed-then-recovered, a
  surface that could not be reached as cannot-reach, and a pass without an evidence line as a failure, none of them as a pass
- AC-005 WHEN a surface the diff touches has zero journeys, or the runner's claimed counts differ from the recount THE SYSTEM
  SHALL block the report or report the mismatch
- AC-006 WHEN the recount renders its output THE SYSTEM SHALL produce one evidence comment and one issue body per failure with
  its transcript, and, when the runner wrote no evidence, mark every derived surface cannot-reach with the environment's reasons
- AC-007 WHEN agent QA runs on a pull request THE SYSTEM SHALL build the environment in the job with a Postgres service, run the
  planner, the runner and the skeptic as separate agents, and post exactly one evidence comment

## Out of scope

- The persona route and seed/reset scripts in the server: spec 082, for P3.
- Promotion to a required check: a human decision after 20 clean runs.

## Notes for the planner

- The runner gets browser tools through the Playwright MCP server, and writes only under qa/.
- Evidence format: e2e/qa/README.md.
