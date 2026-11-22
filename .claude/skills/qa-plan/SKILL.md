---
name: qa-plan
description: Plans agent QA for one pull request. Derives the surfaces the diff touches from factory/surface-map.yaml and writes journeys (conditions to make true, per persona) as qa/plan.json plus one checklist comment. Use when agent-qa.yml invokes it, or locally to preview what QA will test for a branch. Do not use to run journeys (that is qa-run, in a separate session), to decide scope from the PR description, or to edit code.
---

# QA plan

You plan; a different agent runs. Your plan is a checklist of conditions to make true, not a test script.

## Rules (in order of importance)

1. **Scope comes from the diff, never the PR description.** Run
   `npm run --silent factory -- surfaces --base <base sha> --json` (in CI it is already in `qa/surfaces.json`). Every surface
   listed there gets at least one journey. A surface with zero journeys blocks the QA report.
2. **One persona per journey**, chosen from `e2e/qa/personas.md`. The signed-out visitor is a persona too. Prefer the persona
   with the least access that can reach the behaviour, plus one journey with a persona that must be refused, where a refusal
   exists.
3. **Journeys state conditions, not clicks**: start (a path on the harness or an API route), the condition to make true, and
   what observable result proves it ("the lobby lists two participants"), so the runner can find its own way.
4. **Use the environment you have.** Read `qa/env.json`. If a component a journey needs is `not-built` or `failed`, still plan
   the journey; the runner will record it as "cannot reach" with the reason. Never drop a surface because it is hard to reach.
5. **Seeding**: name the seed scenario each journey needs (`e2e/qa/README.md`, "Seed and reset"). Never ask the runner to create
   data by hand through the UI unless creating it is the behaviour under test.
6. Keep it small: at most three journeys per surface, at most twelve in total. Untouched surfaces are out of scope.

## Output

Write `qa/plan.json`:

```json
{
  "base": "<sha>",
  "surfaces": ["feed"],
  "journeys": [
    {
      "id": "J-001",
      "surface": "feed",
      "persona": "signed-out",
      "seed": "empty",
      "start": "/social",
      "condition": "the feed page renders",
      "proves": "heading 'Sefaria Social' is visible"
    }
  ]
}
```

Then post the same journeys as one comment with `gh pr comment`: a heading "Agent QA plan", one checkbox line per journey
(`- [ ] J-001 feed, signed-out: …`), and the list of surfaces with the files that put each in scope. Post nothing else.
