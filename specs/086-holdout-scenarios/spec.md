---
id: "086"
title: Holdout scenarios are judged in three clean trials without leaking their text
status: approved
features: [OPS-091]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Tests written by the building agents share their blind spots. Plan 5.5 L5b keeps a set of user-story scenarios in a private
repository the building agents cannot read, judged nightly by an evaluator agent in three clean trials with one judge per rubric
dimension. The value disappears if scenario text leaks into an issue the builders read, or if an unknown grade is counted as a
pass.

## Acceptance criteria

- AC-001 WHEN scenario files are validated THE SYSTEM SHALL check id, title, story, persona, start path and at least two rubric
  lines with a known dimension, without printing scenario text
- AC-002 WHEN trials are scored THE SYSTEM SHALL require exactly three clean trials per scenario, grade every rubric line pass,
  fail or unknown, and count a trial as satisfied only when every line passed
- AC-003 WHEN a scenario fails THE SYSTEM SHALL write an issue body with the symptom and the observed steps and with any
  scenario or rubric text redacted
- AC-004 WHEN the holdout deploy key, the holdout repository name or the staging URL is not configured THE SYSTEM SHALL skip the
  holdout jobs with a notice naming what is missing
- AC-005 WHEN any workflow other than nightly.yml or release.yml reads the holdout deploy key THE SYSTEM SHALL fail factory
  doctor

## Out of scope

- Creating the holdout repository and its deploy key (a human step, on the setup checklist).
- Writing the real scenarios: a human writes them; five proposals are in the setup checklist's appendix and must move to the
  holdout repository.

## Notes for the planner

- Judge calibration (monthly human labels of about 20 trials) is a process step recorded in docs/runbooks/holdout.md.
