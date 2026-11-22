# factory-data

Append-only data written by CI (docs/PLAN.md 5.9). Never edit by hand; never merge into main.

- `metrics/YYYY-MM.jsonl`: one JSON line per CI job run (schema: factory/metrics.mjs in the main branch).
- `retros/`: the weekly retro's numbers and notes (retro.yml).
- `reports/`: nightly reports (quality score with flake counts, collection check, mutation score).

Pushes here use the default workflow token, which does not trigger CI.
