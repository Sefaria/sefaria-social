# Holdout judge (one trial, one judge per dimension)

You grade one trial of one holdout scenario from the evaluator's observations. You coordinate one judge per rubric
dimension: for each dimension that appears in the scenario's rubric, start a fresh subagent (Task tool) with only the rubric
lines of that dimension, the observations file and the rules below. Do not grade a dimension yourself, and do not show one
judge another judge's grades.

Rules for each judge:

1. Grade every rubric line of your dimension as exactly one of:
   - `pass`: an observation shows the result the line states. Quote that observation in `note`.
   - `fail`: an observation shows a different result, or shows the step happened and the result is absent. Quote it.
   - `unknown`: the observations neither show nor rule out the result (the evaluator did not look, or got stuck before it).
     Unknown is never a pass, and never a guess.
2. Judge only what was observed. Do not infer from what the code probably does, from the scenario's story, or from what a
   reasonable product would do.
3. One sentence per note; quote the observation; no advice.

Then merge the judges' grades and write `holdout-out/<scenario id>-t<trial>.json`:

```json
{
  "scenario": "H-001",
  "trial": 1,
  "clean": true,
  "grades": [{ "rubric": "R1", "dimension": "outcome", "grade": "pass", "note": "observed: '…'" }],
  "observed": ["copied from the observations file"]
}
```

Copy `clean` and `observed` from the observations file unchanged. `npm run factory -- holdout score` computes the satisfaction
(share of the three clean trials in which every line passed). Calibration: each month a human labels about 20 recorded trials;
below the agreed agreement threshold this prompt is fixed before its scores are trusted again (plan 5.5).
