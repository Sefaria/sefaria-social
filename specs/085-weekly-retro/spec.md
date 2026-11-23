---
id: "085"
title: A weekly retro reports the factory's numbers and last week's actions
status: proposed
features: [OPS-090]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Plan 5.9: a weekly retro reads the metrics, tracks whether last week's actions were done, and proposes the smallest change. If
an agent computes the numbers it can get them wrong unnoticed, so the numbers, the state of past action items and the recurring
problems are computed by a script; the agent writes only the narrative and the new action items.

## Acceptance criteria

- AC-001 WHEN the retro script runs on a week of metrics THE SYSTEM SHALL report job runs and the change from the previous week,
  failure rate, skips and median duration per job, review findings, QA verdicts, flaky tests and cost
- AC-002 WHEN previous retros list action items THE SYSTEM SHALL report each as done, not done or dropped, and list every job
  that failed in more than one week with the weeks
- AC-003 WHEN a metrics line is invalid THE SYSTEM SHALL list it in the retro and exit 1
- AC-004 WHEN the fixture retro in docs/retros/ is compared with the script's fixture run THE SYSTEM SHALL find them identical
  and marked as a fixture
- AC-005 WHEN retro.yml runs THE SYSTEM SHALL compute and publish the numbers without any secret, and run the retro agent only
  when its preflight says credentials exist

## Out of scope

- The retro agent opening pull requests: a PR made with the workflow token triggers no CI, so it proposes the edit as a diff in
  an issue and a human opens the PR.

## Notes for the planner

- Retros are published to factory-data (retros/), not committed to main (plan 5.8: workflow commits go to the data branch).
