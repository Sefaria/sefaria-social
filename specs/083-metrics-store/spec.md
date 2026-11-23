---
id: "083"
title: CI records metrics on the factory-data branch and the quality score is generated
status: approved
features: [OPS-085, OPS-086]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

The factory is supposed to be measured and pruned (plan 2.9, 5.9): the weekly retro, QA promotion and harness pruning all need
numbers. Without an append-only store written by every CI job, those decisions rest on impressions. The quality score per
surface must be generated, never typed, so it cannot drift from the tests that exist.

## Acceptance criteria

- AC-001 WHEN a job records a metrics line THE SYSTEM SHALL build it from the Actions environment (run id, commit, workflow,
  job, result, duration, test counts, model, tokens) and validate it
- AC-002 WHEN the first metrics line is written THE SYSTEM SHALL create the factory-data branch as an orphan branch, and later
  writes SHALL append to metrics/YYYY-MM.jsonl
- AC-003 WHEN a line is invalid, or a write would replace a file under metrics/ THE SYSTEM SHALL refuse it
- AC-004 WHEN ci.yml's metrics job runs THE SYSTEM SHALL write one line per job of the run except itself
- AC-005 WHEN ci.yml runs THE SYSTEM SHALL run the metrics job after result, skip forks on purpose, and never fail the run
  because a push was refused
- AC-006 WHEN npm run factory -- quality-score runs THE SYSTEM SHALL write docs/QUALITY_SCORE.md with test files per level for
  each surface, and --check SHALL fail when the committed file is stale

## Out of scope

- Dashboards: the retro reads the JSON lines directly.
- Token counts for ci.yml jobs (they run no model).

## Notes for the planner

- Pushes with the default workflow token do not trigger CI (plan 5.8), so the data branch needs no CI.
- Create factory-data only through a workflow run, never by hand.
