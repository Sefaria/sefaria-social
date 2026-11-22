# Agent QA (L5a)

What `agent-qa.yml` needs from the rest of the repo, and the files it reads and writes. Plan section 5.5. The workflow is
advisory and skips with a notice until Anthropic credentials exist (`docs/runbooks/setup-checklist.md`).

## The pipeline

1. `npm run factory -- surfaces --base <sha> --json` maps the diff to surfaces through `factory/surface-map.yaml`
   (`qa/surfaces.json`). Never the PR description.
2. `node e2e/qa/env.mjs up` builds the environment inside the job (`qa/env.json`): Postgres is a service container; the
   server, harness and relay start from the scripts below when they exist, and are `not-built` (with the milestone) otherwise.
3. The planner (`qa-plan` skill) writes `qa/plan.json` and posts one checklist comment.
4. The runner (`qa-runner` agent, `qa-run` skill) re-derives the surfaces, performs the journeys in a browser and writes
   `qa/evidence.json`.
5. `npm run factory -- qa-recount qa/evidence.json --surfaces qa/surfaces.json` recounts and applies what a pass means.
6. The skeptic writes `qa/skeptic.md`; the workflow posts **one** evidence comment (recount + skeptic) and one issue per
   failure, and uploads `qa/` as an artifact.

## Environment contract (root `package.json` scripts)

| Script       | Started by        | Must                                                                                                 | Arrives with |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| `qa:server`  | `env.mjs up`      | serve the social server on `127.0.0.1:3200` with `SOCIAL_ENV=test-<anything>`; `GET /api/health` 200 | P2 / P3      |
| `qa:harness` | `env.mjs up`      | serve the harness on `127.0.0.1:3300`, loading the surface against the server above; `GET /` 200     | P1           |
| `qa:relay`   | `env.mjs up`      | run the relay locally (`wrangler dev`) on `127.0.0.1:8787`; `GET /health` 200                        | P3           |
| `qa:seed`    | the workflow      | `npm run qa:seed -- <scenario>` or `-- --all`; see below                                             | P3           |
| `qa:reset`   | the runner, tests | `npm run qa:reset`; see below                                                                        | P3           |

All of them read `DATABASE_URL` (the workflow sets it to the Postgres service) and `QA_PERSONA_SECRET` (a random value per run,
masked in logs). The server's persona route is specified in `specs/082-test-personas/`.

## Seed and reset

- One file per scenario under `e2e/qa/seeds/<scenario>.json` (or `.ts`), naming the rows it creates by stable ids.
- Seeding twice creates nothing the second time (upsert by stable id); a test asserts it.
- Reset leaves zero rows in every table of the schema, checked against the schema itself (a new table is covered without
  editing the reset), and a test asserts that too.
- Scenario `empty` exists and seeds nothing. No personal data in seeds (the repo's fixtures rule).

## Evidence format (`qa/evidence.json`)

```json
{
  "pr": 12,
  "sha": "<head sha>",
  "planned_surfaces": ["feed"],
  "claimed": { "pass": 1, "fail": 0 },
  "journeys": [
    {
      "id": "J-001",
      "surface": "feed",
      "persona": "signed-out",
      "title": "the feed renders for a visitor",
      "planned": true,
      "attempts": [{ "outcome": "pass", "evidence": ["heading \"Sefaria Social\" [level=1]"], "note": "" }],
      "cannot_reach": null,
      "transcript": "navigate /social; snapshot; heading present"
    }
  ]
}
```

What the recount decides (`factory/qa.mjs`):

| Verdict               | When                                                                                   | A pass? |
| --------------------- | -------------------------------------------------------------------------------------- | ------- |
| pass                  | the last attempt passed, no attempt failed, and it carries an evidence line            | yes     |
| failed-then-recovered | an attempt failed and a later one passed                                               | no      |
| cannot-reach          | `cannot_reach` has a reason (component not built, route missing)                       | no      |
| fail                  | the last attempt failed, or it "passed" with no evidence line                          | no      |
| not-run               | no attempt recorded                                                                    | no      |

A derived surface with no journey blocks the report. A journey on a surface the plan did not list is a planner gap.

## Promotion

Agent QA starts advisory. It becomes a required check for one surface after 20 consecutive runs on that surface with no false
failure, as recorded in the metrics. The weekly retro lists candidates; a human decides and adds the check to the ruleset.
