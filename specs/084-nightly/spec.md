---
id: "084"
title: The nightly finds flaky and uncollected tests and keeps quarantines honest
status: approved
features: [OPS-087, OPS-088, OPS-089]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

A green check must prove something (plan 2.8). Two known holes: tests that pass or fail by chance, and test files that no runner
collects, which pass silently forever. Quarantine is the escape hatch for the first, and is only safe with a reason, an issue
and an expiry. The nightly also runs the slow advisory checks: mutation testing, dependency audit, contract drift, docs
freshness and doctor in full. L4b against the real reader cannot run until the reader seam exists.

## Acceptance criteria

- AC-001 WHEN the suites have run three times THE SYSTEM SHALL list every test whose result differs between runs and fail when
  one is not quarantined
- AC-002 WHEN a test file on disk was not executed by any runner THE SYSTEM SHALL fail the collection check, naming the file and
  its level
- AC-003 WHEN a quarantine entry has expired, or lacks a reason, an issue link, or an expiry within 30 days THE SYSTEM SHALL
  fail the quarantine check
- AC-004 WHEN a quarantined test fails THE SYSTEM SHALL report a notice and not fail, and WHEN a test that is not quarantined
  fails THE SYSTEM SHALL fail
- AC-005 WHEN nightly.yml and e2e-reader.yml are read THE SYSTEM SHALL schedule flake detection, collection, mutation, audit,
  contract drift, docs freshness, doctor and holdout jobs, keep L4b disabled with its reason until the reader seam lands, and
  configure Stryker for Vitest

## Out of scope

- Making mutation score a gate (advisory, plan 5.5 L5c).
- Running L4b: it needs the reader seam (A1) and a reader image.

## Notes for the planner

- Stryker is installed at run time with npm 11 (npm 10 crashes on this tree, F0 notes), so it adds no dependency.
- Quarantined tests still run and report; they do not gate.
