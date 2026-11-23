---
id: "080"
title: Agent lanes run capped and skip cleanly without credentials
status: proposed
features: [OPS-080, OPS-081]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

The factory's agent lanes (review, QA, security review, retro, holdout scenarios) call a paid model with repository tokens.
Tonight no Anthropic credential exists, and a lane that fails for that reason would turn every pull request red. A lane that
runs uncapped, on a fork, or with deploy credentials is a cost and security risk. Plan sections 5.7 and 5.8 require every agent
job to be capped, gated and advisory; this spec makes that a checked property instead of a convention.

## Acceptance criteria

- AC-001 WHEN an agent lane's preflight runs and neither the ANTHROPIC_API_KEY secret nor the OIDC federation variables are
  configured THE SYSTEM SHALL skip the lane with a notice naming the missing secret and docs/runbooks/setup-checklist.md, write
  run=false, and exit 0
- AC-002 WHEN a pull request comes from a fork THE SYSTEM SHALL skip the security review, whatever credentials exist
- AC-003 WHEN credentials are configured THE SYSTEM SHALL run the review lane with the model in the REVIEWER_MODEL variable, or
  an Opus-class default when it is unset
- AC-004 WHEN a workflow job runs an agent action without timeout-minutes, a --max-turns limit, a model, an allowed-tools list,
  a preflight gate, fork refusal or a commit-pinned action, or reads a secret other than the Anthropic key and the workflow
  token THE SYSTEM SHALL fail factory doctor with rule agent-jobs
- AC-005 WHEN a workflow job has no timeout-minutes, needs an unknown job, uses an unpinned third-party action, or reads the
  holdout deploy key outside nightly.yml or release.yml THE SYSTEM SHALL fail factory doctor with rule workflows
- AC-006 WHEN each agent workflow's own preflight step is run with no secrets or variables set THE SYSTEM SHALL skip and exit 0
  for every one of them

## Out of scope

- Running any agent: no credential exists tonight; the lanes are proven by their skip path and by structure.
- Requiring agent review: it is advisory (plan 2); the check it posts is neutral.

## Notes for the planner

- Confirmed action inputs and their differences from the plan: docs/decisions/0080-agent-actions.md.
- The preflight must be zero-dependency so a job can run it before npm ci.
