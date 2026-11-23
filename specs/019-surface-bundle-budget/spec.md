---
id: "019"
title: The surface bundle is minified and held to a size budget in CI
status: proposed
features: [OPS-019]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Every reader page with the social lab on downloads the surface bundle. It ships today as Vite's library output, which keeps
all whitespace: about 608 kB raw and 165 kB gzip, 333 kB of it in the entry. Nothing stops it from growing further, and a
size regression would only be noticed by readers. The plan asks for bundle-size budgets in the `build` job (plan 5.8).

## Acceptance criteria

- AC-001 WHEN the surface is built THE SYSTEM SHALL emit fully minified JavaScript (no indented lines, no `/*#__PURE__*/`
  annotations) and minified CSS, and the manifest SHALL still list every file with its integrity hash
- AC-002 WHEN `npm run surface:budget` runs on a surface build that meets `app/surface-budget.json` THE SYSTEM SHALL print each
  file's raw and gzip size and the totals against their limits, and exit 0
- AC-003 WHEN a build exceeds any budget (entry gzip, largest chunk gzip, total gzip, total raw, number of files) or a file the
  manifest lists is missing THE SYSTEM SHALL exit non-zero, naming the budget, the measured size, the limit and how to fix it
- AC-004 WHEN ci.yml's `build` job runs THE SYSTEM SHALL run the budget check right after the surface build

## Out of scope

- Splitting React or zod out of the surface, or sharing the reader's React (the contract is plain JS; see the plan's 4.2).
- Budgets for the Start server build (it is not downloaded by readers).

## Notes for the planner

- Vite's library mode keeps whitespace in ES output on purpose; `rolldownOptions.output.minify` turns full minification on.
- Budgets carry headroom (10–20 %) over the minified build so normal work does not trip them; raising one is a reviewed change
  to `app/surface-budget.json`.
- Source maps stay out of the release (spec 020); the budget measures what the reader downloads.
