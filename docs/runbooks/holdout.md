# Holdout scenarios (L5b)

Plan 5.5. A small set of user stories with rubrics, kept in a **separate private repository** that building agents cannot read,
judged nightly against the staging build by an evaluator agent. A signal, not a gate: an AI judging AI-built software is partly
circular, so deterministic levels gate merges.

## Wiring (in this repo)

- `nightly.yml` jobs `holdout-list` → `holdout-trial` (one job per scenario and trial: three clean trials, each a fresh runner and
  browser context) → `holdout-score`. Only `nightly.yml` and `release.yml` may read `HOLDOUT_DEPLOY_KEY` (doctor checks).
- All three skip with a notice until the secret `HOLDOUT_DEPLOY_KEY`, the variables `HOLDOUT_REPO` and `STAGING_URL`, and Anthropic
  credentials exist.
- Prompts: `factory/prompts/holdout-evaluator.md` (drives the build and records observations; does not grade) and
  `factory/prompts/holdout-judge.md` (one judge per rubric dimension, each a fresh subagent; pass, fail or unknown per line).
- Scoring and issues: `npm run factory -- holdout validate|score|issues` (`factory/holdout.mjs`). A failure opens an issue with the
  symptom and the observed steps; any scenario or rubric text is redacted and the body is checked before it is written. The
  hand-filing form is `.github/ISSUE_TEMPLATE/holdout-failure.yml`.

## Scenario format (in the holdout repo, `scenarios/H-NNN.yaml`)

```yaml
id: H-001 # H- and three digits; never reused
title: One line
story: As a <persona> I … and expect … # what a person wants, not how to click
persona: learner # one of e2e/qa/personas.md in this repo
start: /social # a path on the staging build
rubric: # at least two lines; each an observable result
  - id: R1
    dimension: outcome # outcome | navigation | state | language | accessibility | resilience
    line: The lobby lists both participants by display name.
  - id: R2
    dimension: navigation
    line: Browser Back returns to the reader page the person came from.
```

Satisfaction = the share of clean trials in which every rubric line was graded pass. Unknown is never a pass. The nightly records
it as a metrics line (`holdout`, `extra.satisfaction`) so the retro shows its trend.

## Calibration (monthly, human)

Each month a holdout owner labels about 20 recorded trials (the `holdout-H-*` artifacts) with their own pass/fail/unknown per line
and records the agreement with the judges in the holdout repo. Below the agreed threshold (default 85%), fix
`factory/prompts/holdout-judge.md` before trusting its scores again.

## Rules for people

- Never paste scenario text into this repository, an issue, a PR or a chat an agent reads. A leaked scenario is retired and replaced.
- The five proposed scenarios in the setup checklist's appendix are a starting point; move them to the holdout repo, rewrite them
  in your own words, and delete them from this repository in the same week.
