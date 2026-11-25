# Shiur: progress

The plan is `docs/plans/shiur.md`. This file says where the work stands, so a new session (or the same one after its context
was summarised) can pick up without re-deriving it. Update it in the same PR as the work it describes. Keep it short: states
and facts, not a diary.

## Specs

States: `not started`, `spec drafted`, `building`, `built` (all checks pass, awaiting approval), `approved`, `merged`.

| Spec | Title                                                           | State       | PR  | Notes |
| ---- | --------------------------------------------------------------- | ----------- | --- | ----- |
| 048  | Sticky following, a fixed leader, follow a person by their head | not started |     |       |
| 049  | One press to get in                                             | not started |     |       |
| 050  | Session kinds and endings                                       | not started |     |       |
| 051  | The asset in object storage                                     | not started |     |       |
| 052  | Processing                                                      | not started |     |       |
| 053  | The player                                                      | not started |     |       |
| 054  | Transcript                                                      | not started |     |       |
| 055  | Links in posts                                                  | not started |     |       |
| 056  | Live cards                                                      | not started |     |       |

## Waiting on the owner

| What                                                          | Needed by                                                                                   | State |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----- |
| Confirm or change the open points of the plan's section 8     | 050 (grace, new session in a closed room), 051 (retention, limits), 055 (one card per post) | open  |
| Sofer.ai API key as `SOFER_API_KEY`                           | 054, for a live transcript                                                                  | open  |
| Storage bucket and the server's access to it, per environment | 051 and 052 outside local runs                                                              | open  |
| `factory approve` for each spec                               | each PR's `spec-gate`                                                                       | open  |

## Built on a proposal

List here each open point of section 8 that code now depends on, with the spec and the file, so it can be found and changed
if the owner decides otherwise.

- (none yet)

## QA passes

| Group | Date | Preview | Result |
| ----- | ---- | ------- | ------ |
|       |      |         |        |

## Log

Newest first. One or two lines per entry: what changed, and anything the next session must know that the code does not say.

- 2026-11-25: Plan, kickoff prompt and this file added. Upload cap fixed and size budget raised in #33 (merged). Two points
  of section 4.2 were checked in the code and the plan now states the findings: a non-host cannot take the spotlight in
  `presenter` mode, and a change applied with origin `follow` is not published.
