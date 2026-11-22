---
name: build-task
description: Builds one task of a compiled work order, test-first, in this session, ending with verify and a PR. Use when a work order exists (specs/NNN-slug/workorder.json) and you are asked to build a task such as 012/T-003. Do not use without a compiled work order, for more than one task per session, or to edit the spec, tasks.yaml or the approval.
argument-hint: "NNN/T-xxx"
---

# Build one task

**Critical rules — read first**

1. Activate the task first: `node .claude/skills/build-task/scripts/activate.mjs NNN T-xxx`. The guard hook blocks product
   edits outside the active task's file globs; do not work around it (no shell redirects into product files).
2. Test first. Write the AC's test, tag it `// @ac NNN/AC-xxx` (and `// @feature AREA-NNN <name exactly as in the atlas>`),
   run it, and see it fail on an assertion. Then write the code.
3. Every commit carries trailers: `git commit -m "<type>(<scope>): <summary>" --trailer "Spec: NNN" --trailer "Task: T-xxx"`.
4. If the task completes a feature: set its atlas entry to `built`, list the tagged test files in `tests`, and add a line to
   `docs/features/CHANGELOG.md`, in the same PR.
5. Finish with the `verify` skill. No PR on FAIL. Never flip a work-order AC to `passes: true` without CI evidence.

## Steps

1. Read `specs/NNN-slug/workorder.json` (the task's files, ACs, verify commands) and `plan.md`.
2. Activate (rule 1). Run the task's verify commands once to record the baseline.
3. Red: tests for the task's ACs. Green: the smallest code that passes. Refactor with tests green.
4. Run the task's verify commands, then `npm run factory -- atlas` and `npm run factory -- gate --base origin/<base>`.
5. Run `/verify`, paste its evidence block into the PR body, open the PR against the milestone branch.
6. Deactivate: `node .claude/skills/build-task/scripts/activate.mjs --clear`.
