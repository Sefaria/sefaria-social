# Shiur: progress

The plan is `docs/plans/shiur.md`. This file says where the work stands, so a new session (or the same one after its context
was summarised) can pick up without re-deriving it. Update it in the same PR as the work it describes. Keep it short: states
and facts, not a diary.

## Specs

States: `not started`, `spec drafted`, `building`, `built` (all checks pass, awaiting approval), `approved`, `merged`.

| Spec | Title                                                           | State  | PR  | Notes                                                                                         |
| ---- | --------------------------------------------------------------- | ------ | --- | --------------------------------------------------------------------------------------------- |
| 048  | Sticky following, a fixed leader, follow a person by their head | merged | #35 | Broadcast viewers still break away on any input (Back to live).                               |
| 049  | One press to get in                                             | merged | #35 | The lobby's Join call keeps its device step (for coming back to a call).                      |
| 050  | Session kinds and endings                                       | merged | #35 | A broadcast started from the dialog does not join the host to the broadcast's call by itself. |
| 051  | The asset in object storage                                     | built  | #37 | Approved. Filesystem store until a bucket adapter.                                            |
| 052  | Processing                                                      | built  | #37 | Approved. Queue on the row (decision 0014), not pg-boss.                                      |
| 053  | The player                                                      | built  | #37 | Approved.                                                                                     |
| 054  | Transcript                                                      | built  | #38 | Approved. Tested against a fake Sofer.ai only; needs the key.                                 |
| 055  | Links in posts                                                  | merged | #36 | Approved                                                                                      |
| 056  | Live cards                                                      | merged | #36 | Approved; relay needs `SOCIAL_SERVER_URL`                                                     |

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
- 050: a session ends 2 minutes after its owner is gone (`packages/session/src/room.ts`, `endAfterMs`).
- 050: a closed room starts a new session when its owner enters (`room.ts`, `reopen`). The relay keeps rooms in memory only,
  so an emptied closed room may be forgotten; remembering it belongs with the asset (spec 051).
- 052: the processing queue lives on the recording's row (decision 0014; spec 052 cites it as 0013) instead of pg-boss (the plan's research proposal).
- 053: the replay's video stays in the floating frame, pinned at the recorded head place; the controls moved to the bar.
- 050: the session's kind is kept per room for the tab (`features/session/session-kind.ts`); after a reload the owner sees
  Close room, or End broadcast while a broadcast is live.
- One card per post (055): `app/src/features/post/Composer.tsx` takes only the first session link out of the text.
- Live status mechanics of 4.7 (056): the relay's reports (`packages/relay/src/live-report.ts`, `worker.ts`), the
  `live_status` table, the 5-second cache, 15-second polling (`app/src/features/post/live-status.ts`); details and the
  fallback to the relay's status read in `docs/decisions/0013-links-and-live-cards.md`.
- The public `GET /api/v1/live` answers only ids some post embeds (`app/src/server/services/live.ts`; decision 0013).

## QA passes

| Group | Date       | Preview                                                | Result                                                                                                                                                                                                                                                                                                      |
| ----- | ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | 2026-11-25 | not run on the preview (two signed-in accounts needed) | Independent code review by a fresh agent: 5 findings (forged `?join=1`, pass-on repeat guard, echo between mutual followers, minimised room not told it closed, holds lost when a session was replaced), all fixed with tests; full desktop e2e suite 28 passed against the real server, relay and LiveKit. |

## Log

Newest first. One or two lines per entry: what changed, and anything the next session must know that the code does not say.

- 2026-11-26: Group C (054) built on #38, stacked on #37. Tested only against a fake Sofer.ai built from their documented
  API; watch the first real run (`transcript.*` log events). Audio goes inline (base64, up to 40 MB, about 80 minutes) unless
  `SOCIAL_PUBLIC_ORIGIN` is set. A fresh-agent review found 10 problems (rate limit, the 6-hour limit while polls error,
  `/audio` in memory, silent recordings queued, and others); all fixed with tests. Group B's Helm values lacked
  `ASSET_STORE_DIR` and `ASSET_WORKER` (a factory test caught it in CI); fixed on #37.
- 2026-11-26: Group B (051–053) built on #37 overnight. A fresh-agent review found 8 problems (whole files in memory on public
  reads, a crash loop on out-of-memory, the replay pausing when the video hid, the filesystem store unwritable in the image,
  lease overlap, leftover media after deletion, a bad address failing processing, keyboard on the seek bar); all fixed with
  tests. The filesystem store needs a volume (Coolify app has one) and does not work across replicas: a bucket adapter is the
  next step before production. ffmpeg is in the image and CI.
- 2026-11-25: Group D (055, 056) built on `m/shiur-group-d`, draft PR #36. Migrations `0007_post_embeds`, `0008_live_status`.
  The relay needs a new variable, `SOCIAL_SERVER_URL` (setup checklist); until then the server reads the relay's status.
  The card's poller watches only cards on screen: in the harness the reader pane pushes the timeline below the fold, so
  e2e tests scroll a card into view. Rebased onto main after group A merged (#35): the live-card journey's publisher owns
  its room and offers its owner ticket, since only the owner holds the spotlight (048).
- 2026-11-25: Group A review fixes. Known limits left: an owner's second tab displaces the first in the relay (older
  rule), so the 2-minute end can start while the first tab is open; a room ticket fetch that fails on the network makes the
  owner a member until the socket reconnects. The broadcast relay test's join order was a race: the relay test helper now
  orders participants by id.
- 2026-11-25: Spec 050 built. The recorder pauses MediaRecorder and its shared clock; messages from the state writer are
  dropped while paused (a seq gap, which readers recover from at the resume keyframe). The in-app test relay takes
  `owners` to mirror owner tickets. Group A's local checks all pass; e2e journeys run with livekit-server from the
  Homebrew cache.
- 2026-11-25: Spec 049 built. A Join pressed while signed out rides in the lobby's address (`?join=1`), because reader-next
  sends sign-in to `/login?next=<page>` and the lobby mounts again on return; nothing is stored.
- 2026-11-25: Spec 048 built. Room relay tickets (`POST /api/v1/rooms/{id}/ticket`, roles owner/member) make the owner the
  only leader; decision 0012 supersedes 0008's everyone-may-lead. Relay tests' `connect` offers an owner ticket by default
  (`owner: false` for a member), so older relay tests keep their meaning. Sticky following applies to rooms only.
- 2026-11-25: Plan, kickoff prompt and this file added. Upload cap fixed and size budget raised in #33 (merged). Two points
  of section 4.2 were checked in the code and the plan now states the findings: a non-host cannot take the spotlight in
  `presenter` mode, and a change applied with origin `follow` is not published.
