# Shiur: the prompt to start a building session

Paste the block below as the first message of a session opened in a checkout of `Sefaria/sefaria-social`. Change the first
line to the group the session should build. One session builds one group; a later session picks up from the progress file.

```text
Build group A (specs 048, 049, 050) of the shiur plan.

Read, in this order, before anything else:
1. CLAUDE.md
2. docs/plans/shiur-progress.md   (where the work stands; trust it over your own guess)
3. docs/plans/shiur.md            (sections 0 to 3 in full, then only the parts of 4 to 6 for your specs)
4. docs/runbooks/working-in-the-factory.md

Then:
- Run `npm ci`, `npm run typecheck` and `npm test` on the untouched checkout. If either check fails, stop and tell me.
- Work from a new branch off origin/main. Take the specs in order, one at a time, with /shape-spec, /plan-spec,
  `npm run factory -- compile NNN --draft`, /build-task per task, and /verify. Section 0.1 of the plan says when a spec is
  done; section 6 has the acceptance lines to carry into each spec.
- Open one draft PR for the group. Update docs/plans/shiur-progress.md in the same PR after every spec.
- When the group is built, run the QA pass of the plan's section 10 against the PR's preview as a separate pass, and
  record the result in the PR.

Rules for this session:
- I approve specs and merge PRs. You never run `factory approve` and never merge. A failing `spec-gate` that says
  "spec NNN not approved" is expected on your draft PR; every other check must pass.
- Do not create or change secrets, buckets, Helm or Coolify settings. If a spec needs one, add the step to
  docs/runbooks/setup-checklist.md and build everything that does not depend on it.
- Section 2 of the plan is decided. Section 8 lists proposals I have not confirmed: build them as written and list them
  in the PR under "Built on a proposal".
- Stop and ask me only in the cases of the plan's section 0.3. Otherwise decide, record the decision in docs/decisions/,
  and keep going.
- Report honestly: paste the real output of each check, and name anything you could not run or verify.
```

## Which group next

| Group | Specs         | Can start when                                                                                                |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| A     | 048, 049, 050 | now                                                                                                           |
| B     | 051, 052, 053 | 050 is on the branch it stacks on (or merged); 051 and 052 need the bucket for anything beyond local runs     |
| C     | 054           | 052 and 053 are built; a live transcript needs `SOFER_API_KEY`, the rest is built against a recorded response |
| D     | 055, 056      | now; independent of A, B and C                                                                                |

A and D touch different files and can run as two sessions at once, each in its own worktree. B changes the recording
controller that 050 also changes, so it starts after 050.

## Before starting a session

- The session needs to run `npm`, `git`, `gh` and Playwright without asking each time; allow those in its permission
  settings before a long unattended run.
- The e2e suite needs the `livekit-server` binary on `PATH` (`docs/design/audio-video.md`). Without it, say so in the PR
  instead of skipping silently; CI runs it.
- A cloud session starts from `origin/main`, so this plan must be merged before it starts.
