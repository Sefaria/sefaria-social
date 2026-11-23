# Retros

The weekly factory retro (plan 5.9). Real retros are written by `.github/workflows/retro.yml` to the **`factory-data`** branch
(`retros/YYYY-Www.md`), because workflow commits go to the data branch, which needs no CI (plan 5.8;
[decision 0080](../decisions/0080-agent-actions.md)). Read them with `git show origin/factory-data:retros/<week>.md`.

This folder holds the format: [2026-W48.md](2026-W48.md) is a **fixture run** of `npm run factory -- retro --fixture` on the
sample metrics in `factory/test/fixtures/metrics/`, not real data. A test keeps it identical to the script's output.
