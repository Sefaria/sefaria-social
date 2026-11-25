# Shiur: progress

The plan is `docs/plans/shiur.md`. This file says where the work stands, so a new session (or the same one after its context
was summarised) can pick up without re-deriving it. Update it in the same PR as the work it describes. Keep it short: states
and facts, not a diary.

## Specs

States: `not started`, `spec drafted`, `building`, `built` (all checks pass, awaiting approval), `approved`, `merged`.

| Spec | Title                                                           | State       | PR      | Notes                                                                                                    |
| ---- | --------------------------------------------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------- |
| 048  | Sticky following, a fixed leader, follow a person by their head | built       | group A | Awaiting `factory approve 048`. Broadcast viewers still break away on any input (Back to live).          |
| 049  | One press to get in                                             | built       | group A | Awaiting `factory approve 049`. The lobby's Join call keeps its device step (for coming back to a call). |
| 050  | Session kinds and endings                                       | not started |         |                                                                                                          |
| 051  | The asset in object storage                                     | not started |         |                                                                                                          |
| 052  | Processing                                                      | not started |         |                                                                                                          |
| 053  | The player                                                      | not started |         |                                                                                                          |
| 054  | Transcript                                                      | not started |         |                                                                                                          |
| 055  | Links in posts                                                  | not started |         |                                                                                                          |
| 056  | Live cards                                                      | not started |         |                                                                                                          |

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

- 049: a first-time starter enters with the microphone on and the camera off (`app/src/features/av/device-memory.ts`,
  `FIRST_TIME`).
- 049: the lobby's "Join call" (for someone who left the call) keeps its device-choice step; Start, Join and Enter skip it.
  The plan said the pre-join step is removed; D6 only requires that entering joins the call.

## QA passes

| Group | Date | Preview | Result |
| ----- | ---- | ------- | ------ |
|       |      |         |        |

## Log

Newest first. One or two lines per entry: what changed, and anything the next session must know that the code does not say.

- 2026-11-25: Spec 049 built. A Join pressed while signed out rides in the lobby's address (`?join=1`), because reader-next
  sends sign-in to `/login?next=<page>` and the lobby mounts again on return; nothing is stored.
- 2026-11-25: Spec 048 built. Room relay tickets (`POST /api/v1/rooms/{id}/ticket`, roles owner/member) make the owner the
  only leader; decision 0012 supersedes 0008's everyone-may-lead. Relay tests' `connect` offers an owner ticket by default
  (`owner: false` for a member), so older relay tests keep their meaning. Sticky following applies to rooms only.
- 2026-11-25: Plan, kickoff prompt and this file added. Upload cap fixed and size budget raised in #33 (merged). Two points
  of section 4.2 were checked in the code and the plan now states the findings: a non-host cannot take the spotlight in
  `presenter` mode, and a change applied with origin `follow` is not published.
