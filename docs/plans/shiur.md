# Shiur: one asset, fewer clicks, sticky following, live cards

Status: written 2026-11-25 from the owner's walkthrough of the dev deployment and his answers to twelve questions. Section 2
lists what he decided (also recorded as `docs/decisions/0011-shiur-owner-decisions.md`); everything in sections 4–6 that is
not in section 2 is a proposal and is marked so. This file is the brief for the sessions that build it.

- **Starting a session on this plan:** `docs/plans/shiur-kickoff.md` has the prompt to start from.
- **Where the work stands:** `docs/plans/shiur-progress.md`. Read it first and update it in every PR.
- When this plan and `docs/PLAN.md` disagree about recordings, rooms' endings or following, this plan is the newer word of
  the owner; write a decision record for each place you find and carry on.

## 0. How to work on this

- **Repo:** `Sefaria/sefaria-social`; branch from `origin/main`. The reader side is `Sefaria-Project` `reader-next/`
  (another repository: a change there is a separate PR, and this plan needs none unless 4.2's last point applies).
- **Before the first edit:** `npm ci`, then run `npm run typecheck` and `npm test` once on an untouched checkout. If either
  fails there, stop and say so; do not build on a red base. `docs/runbooks/working-in-the-factory.md` and
  `docs/runbooks/server.md` say what the integration and e2e suites need (Postgres, the relay, `livekit-server`).
- **Read first, always:** `CLAUDE.md`, `docs/runbooks/working-in-the-factory.md`, this file's sections 1–3, and the
  progress file. Read the rest only for the spec in hand:

  | Spec     | Read before starting                                                                                                                                                                                              |
  | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 048      | `packages/session/README.md`, `packages/session/src/client.ts`, `room.ts`, `core/api.ts`, `.claude/rules/relay.md`, `docs/ROUTING.md`                                                                             |
  | 049      | `docs/design/room-flows.md`, `docs/design/audio-video.md`, `features/session/controller.ts`, `features/av/`                                                                                                       |
  | 050      | `docs/design/session-recording-and-broadcast.md`, `features/recording/`, `features/broadcast/`, `packages/relay/`                                                                                                 |
  | 051, 052 | `docs/design/session-recording-and-broadcast.md`, `server/services/recordings.ts`, `recording-store.ts`, `.claude/rules/db.md`, `.claude/rules/security.md`, `docs/runbooks/deploy.md`, `docs/runbooks/server.md` |
  | 053      | `features/replay/`, `.claude/rules/styling-i18n.md`, `features/av/insets`                                                                                                                                         |
  | 054      | section 5.4 here, then `https://docs.sofer.ai` (the docs may have changed since 2026-11-25: check before coding)                                                                                                  |
  | 055, 056 | `features/post/`, `features/feed/`, `.claude/rules/server-api.md`, `docs/CONTRACT.md`, `packages/relay/`                                                                                                          |

- **The factory:** no code without a spec. Each spec lives in `specs/NNN-name/` (`spec.md`, `acceptance.feature`,
  `tasks.yaml`, `plan.md`). Draft the spec, `npm run factory -- compile NNN --draft`, build, and the owner runs
  `npm run factory -- approve NNN --by <his email>` himself. An agent never runs `approve`. After approval:
  `compile NNN`, commit `specs/approvals.json` and the work order.
- **Factory rules that cost time before:**
  - Every commit needs `Spec: NNN` and `Task: NNN/T-xxx` trailers; in a PR naming several specs a bare `T-001` fails.
  - Every changed file must be inside a named task's globs. Touching `factory/**` forces spec risk `high`.
  - An `@ac` test must fail on the merge base with an assertion error (prove-red). A test that passes on base is a guard:
    leave it untagged. Put new tests above tagged ones.
  - Fill the "planned" atlas entries `compile` adds in `docs/features/features.json`; each AC belongs to one feature.
  - Run `npm run format:check` before pushing. Formatting an approved `spec.md` voids its approval.
  - A change of at most 30 lines with no new file needs no spec (the gate's trivial lane).
  - `main` has no required checks, so `gh pr merge --auto` merges at once. Wait for CI yourself before merging.
  - A new always-present API field breaks older exact-match tests; add fields only when they carry a value.
  - Keep new UI out of `[data-social-page=feed]` and off the space above the rail's cards (visual baselines).
- **Checks to run locally before a PR:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:integration`, `npm run test:contract`, `npm run factory -- gate --base origin/main`,
  `npm run factory -- prove-red`, `npm run factory -- atlas`, `npm run build:surface && npm run surface:budget`, and the
  Playwright suite (it needs the `livekit-server` binary on `PATH`; see the A/V runbook).
- **Where to test by hand:** the reader at the cauldron with `?social_version=<pr>`; hosts are
  `app-/surface-/relay-social.coolifydev.sefaria.org` (previews prefix the PR number). The app answers 404 for about a
  minute after a deploy. Calls are on for previews only.
- **Two SurfaceHost objects:** reader-next gives the page mount and the persistent mount different hosts. Anything kept
  "per host" must go through `features/host/document-host.ts` (`documentHostFor`).

### 0.1 Order of work, and when a spec is done

1. Take the specs in the order of section 6, one spec at a time: `/shape-spec` (carry the acceptance lines of section 6
   into `acceptance.feature`), `/plan-spec NNN`, `compile NNN --draft`, then `/build-task` task by task, then `/verify`.
2. A spec is **done** when every acceptance line has a tagged test that failed on the merge base and passes now, every
   local check in the list above passes, the atlas entries are filled, and `/verify` ends with a passing VERDICT whose
   output is pasted in the PR. "It should work" is not done; a check that could not be run is named in the PR.
3. Open each group (A, B, C, D) as a **draft** PR, one spec per commit series, and move on. Do not wait for approval to
   start the next spec in the same group: later specs stack on the same branch. Start the next group from `origin/main`.
4. After each spec, update `docs/plans/shiur-progress.md` (state, PR, what was decided, what is left) in the same PR.
5. At the end of each group, run the QA pass of section 10 against the PR's preview and record the result.

### 0.2 What only the owner does

Do not do these, and do not work around them; note the need in the progress file and in
`docs/runbooks/setup-checklist.md`, and keep building what does not depend on them.

- `npm run factory -- approve NNN` (the command refuses agent sessions). Until then `spec-gate` fails on the PR with "spec
  NNN not approved"; that failure is expected and is the only one allowed on a draft PR.
- Merging any PR. Marking a PR ready for review is fine once its other checks pass.
- The Sofer.ai key, the storage bucket and its credentials, Helm or Coolify secrets, and anything in section 7.
- Confirming or changing a point in section 8. Build the proposal as written, behind the smallest surface you can, and
  list it in the PR under "Built on a proposal".

### 0.3 When to stop and ask

Stop, write what you found in the progress file, and end the session with a question when: a decision of section 2 turns
out impossible or contradicts another; a spec needs a change to the pinned host contract or to reader-next; a migration
would delete anything other than the recordings D12 allows; a check fails on an untouched `origin/main`; or the same
failure survives three different fixes. Otherwise decide, write a decision record, and continue.

## 1. What the owner wants, in one paragraph

A leader teaches in the reader while talking. Whether they do it alone (a recording), to a view-only audience (a
broadcast) or with people who can interact (a room), the result is the same **one asset**: everything the leader showed
in the reader, their voice, their video when there was one, and a transcript, behind one link. Anyone with the link,
signed in or not, opens the reader and plays it with a bar at the bottom: play, pause, seek, markers for each text the
leader went to, the ref shown on hover, the transcript running underneath, the talking head where the leader put it.
Getting into a session takes one click. Following the leader is sticky. A room or broadcast link pasted into a post
becomes a Join card that shows, live, the text the session is on.

## 2. Decisions the owner made (2026-11-25)

| #   | Decision                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A recording captures **only the leader**: their voice, their camera, their reader. No other participant's audio or video is recorded.                                                                                      |
| D2  | An asset link opens for **anyone who has it, signed out included**.                                                                                                                                                        |
| D3  | **The leader is always the leader** (the room's owner). Nobody else can take the room over.                                                                                                                                |
| D4  | Anyone can click another person's head and go to where that person is (as in Figma or Google Docs). When the **leader** does this, everyone following the leader goes too.                                                 |
| D5  | Recording can be **turned on and off during** a session. It is not fixed at the start.                                                                                                                                     |
| D6  | Entering a session joins the call automatically. Invitees come in with **microphone and camera off**; the starter's last choice is remembered.                                                                             |
| D7  | A follower breaks away only by a clear move: a **different section or book, or at least 5 segments away**. Scrolling, clicking a segment, opening a side panel, or any click on Social's own windows keeps them following. |
| D8  | People may minimise, enlarge and rejoin a live room. **Closing** (leader only) closes it for everyone and starts creating the asset.                                                                                       |
| D9  | A public post of a room link shows what is being studied and is an open invitation. That is intended.                                                                                                                      |
| D10 | Transcription language is **chosen by the user**; the default is English with Hebrew words in Hebrew script.                                                                                                               |
| D11 | Adding an **object storage bucket** and **ffmpeg** in the server image is approved.                                                                                                                                        |
| D12 | Existing recordings are test data and **can be deleted**.                                                                                                                                                                  |
| D13 | Playback shows the video when there is one; some assets are audio only; the viewer can **hide the video**.                                                                                                                 |
| D14 | The leader's talking-head position is recorded and replayed.                                                                                                                                                               |
| D15 | Words for ending: a recording is **finished**, a broadcast is **ended**, a room is **closed** by its leader and **left** by a follower. Deleting a room is not how a session ends.                                         |
| D16 | Storage is not a zip (research, section 5.1); transcription is by Sofer.ai (section 5.4).                                                                                                                                  |

## 3. What exists today (all on `main` since PR #30)

- **Rooms:** start dialog, `/social/rooms`, lobby `/social/r/:id` (invite link, settings, recordings list), room window
  card in the persistent mount (`features/session/FollowBar.tsx`).
- **Following:** `packages/session/src/client.ts`. The room has a _spotlight_ (the leader) and a leadership mode
  (`presenter | hand-raise | open`); `follow(id)` already lets a person follow any participant. `api.onLocalInput(breakAway)`
  pauses following on **any** input the reader reports. The UI has a Lead button that takes the spotlight.
- **Calls:** LiveKit, `features/av` (CallButton, PreJoin, CallPanel, Tiles, Controls), a floating call window.
- **Recording:** `features/recording` captures in the owner's browser: a canvas compositor plus a Web Audio mixer of the
  call into one MediaRecorder (WebM, 5-second chunks), and the reader's state stream as a second track on the same clock.
  Chunks and state batches are stored **in Postgres** behind a `RecordingStore` seam (`server/services/recording-store.ts`).
- **Replay:** `/social/rec/:id`, `features/replay` (player, state track, Transport, ReplayWindow): the video clock drives
  `host.reader.state.applySnapshot`.
- **Broadcast:** rooms `b_<id>`, an HMAC ticket, the relay drops viewers' sends, LiveKit viewers cannot publish.
- **Feed:** posts, replies, profiles, activity, sharing. Post text is plain; URLs are not links.

**Bugs found in the walkthrough**

| Bug                                          | Cause                                                                                                                                                               | State                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| "Upload failed" while recording              | `app/scripts/start.mjs` (production only) refused bodies over 1 MiB; chunks may be up to 4 MiB. A retried chunk whose first try landed was refused as out of order. | Fixed: sefaria-social#33, merged (`fc309a7`) |
| Release on `main` blocked                    | Surface size totals over budget after #30                                                                                                                           | Raised: sefaria-social#33, merged            |
| Every click breaks following                 | `onLocalInput` fires for any input, including clicks on Social's windows                                                                                            | Spec 048                                     |
| The follower does not see the leader's video | They are not connected to the call until they press Join call, then Join                                                                                            | Spec 049                                     |
| A posted room link is dead text              | No link parsing in posts                                                                                                                                            | Spec 055                                     |
| The only way to end a room is Delete         | No close action                                                                                                                                                     | Spec 050                                     |

## 4. Target behaviour

### 4.1 Getting in (D6)

- **Start:** Start → name → **Start** lands the leader _in the room_: reader in the room's context, call connected, call
  window open. No Enter, no Join call, no pre-join step. The dialog also offers "Record this session" (off for a room)
  and the kind: room, broadcast (view-only audience), or recording (just me). These are starting values (D5).
- **Invitee:** the link opens the lobby with one button, **Join**. One press makes them a member, enters the room at
  the leader's place, and connects the call with microphone and camera off, so the leader's video is on screen at once.
  Signed out: Join sends them to sign in and continues by itself on return.
- **Pre-join is removed.** Microphone and camera are toggled in the call window. The starter's last choice is kept in
  `localStorage` (try/catch). When calls are off (`CALLS_ENABLED`), entering works the same without a call.
- _Proposed:_ a browser that blocks audio until a gesture shows the existing "Start audio" button; the Join press usually
  counts as that gesture because the navigation is in-document.

### 4.2 Following (D3, D4, D7)

- The leader is the room's owner for the whole session. Remove the Lead button and stop offering `open` and `hand-raise`
  from the interface; the room runs in `presenter` mode. _Checked 2026-11-25 in `packages/session/src/room.ts`
  (`handleControl`): in `presenter` mode a `spotlight` message is accepted only from the host or the current holder, and
  `mode` and `end` are host only. So a non-owner cannot take the room today; what remains is that the holder can hand the
  spotlight to someone else. Decide in the spec whether the room should refuse that too (D3 says yes), and keep a test._
- Clicking a person, in "who is here" or on their video tile, follows that person (`follow(id)`, which exists). Clicking
  the leader, or Follow again, returns to the leader.
- **Leader follows someone:** the leader's reader goes where that person is, and the leader's followers go along. _Checked 2026-11-25:
  it does not work today. `packages/session/src/core/api.ts` opens a window around every applied change, and subscribers
  (the stream writer in `core/stream.ts` among them) ignore what happens inside it and re-baseline afterwards, so a
  change applied with origin `follow` is never published and the leader's followers stay behind. The rule to build: the
  leader's stream always reflects what the leader's reader shows (for example a keyframe after a follow-apply settles,
  while this person holds the spotlight)._ Guard against a loop when two people follow each other.
- **Sticky rule (D7):** input alone never breaks away. After the reader settles (about 400 ms after the last local
  change), compare the follower's place with the followed person's last place. Break away only when the book or section
  differs, or the segment is 5 or more away in the same section. Within that tolerance the next move by the leader
  brings the follower back in step. Input on Social's own windows never counts.
- _The `onLocalInput` signal comes from the reader (pinned contract `packages/host-contract/pinned/surface-host.v1.ts`).
  Prefer doing the comparison in Social with the reader state API, so no contract change is needed. If the reader fires
  the signal for clicks inside Social's mounts, fix that in reader-next as a separate small PR._

### 4.3 Recording during a session (D1, D5, D14)

- **One Record control**, in the room window, for the leader only. It can be turned on and off any number of times.
  All the recorded stretches of one session make **one asset**; time between them is cut. Use `MediaRecorder.pause()` /
  `resume()` and pause the state-track clock with it, so the asset has one continuous clock.
- **Only the leader is captured (D1):** the audio is the leader's microphone only (drop the mixer's remote tracks). The
  video is the leader's camera only. A notice "Recording" stays visible to everyone (it exists).
- **Camera on and off:** _proposed:_ keep the canvas as the video source and draw only the leader's camera on it, so the
  camera can be switched during a recording. Record `camera on/off` in the timeline. If the camera was never on, the
  processing step produces an audio-only asset.
- **Head position (D14):** a new timeline track of `{t, x, y, w, h}` in fractions of the viewport, written when the
  leader moves or resizes their call window. Replay puts the head there.
- **Solo recording:** a recording session with nobody else must not need LiveKit. Capture from `getUserMedia` directly
  and share those tracks with the call when there is one.
- Broadcasts start with recording on; rooms start with it off; a recording session starts with it on.

### 4.4 Ending (D8, D15)

| Who                       | Button                   | What happens                                                                      |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Leader, recording session | **Finish and save**      | Stops capture, closes the session, starts processing, opens the asset's page      |
| Leader, broadcast         | **End broadcast**        | Viewers see "The broadcast has ended" with a link to the asset once ready         |
| Leader, room              | **Close room** (confirm) | Everyone is taken out; the call ends; if anything was recorded, processing starts |
| Follower                  | **Leave**                | Only they leave                                                                   |

- Minimise, Enlarge and rejoining a live session stay as they are.
- The protocol already has `{type: "end"}` and `ended` on the room; use them. The leader closing their tab does not end
  the session at once: _proposed_ a 2-minute grace, then the relay ends it and the server finalises what was uploaded.
- _Proposed:_ a closed room keeps its page with its assets, and the leader can **Start a new session** in it. Delete
  stays in room settings for removing the room and its assets.

### 4.5 The asset (D2, D12, D13, D16)

**Files, under one prefix in object storage** (`shiurim/<assetId>/`):

| File                                | Content                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`                     | Schema version, title, leader, duration, which files exist with type, size and checksum, `hasVideo`, chapter list, transcript status and language |
| `timeline.json`                     | The reader's Recording v1 state track, plus the overlay track (head position, camera on/off)                                                      |
| `media.webm`                        | Video and audio, remuxed so it can be seeked (absent when audio only)                                                                             |
| `audio.m4a`                         | Audio only; what audio-only playback and transcription use                                                                                        |
| `transcript.json`, `transcript.vtt` | Word timestamps from Sofer.ai, and cues built from them                                                                                           |
| `raw/000000.webm …`                 | The uploaded chunks, deleted after processing succeeds                                                                                            |

- Postgres keeps the asset row (id, room, owner, status, duration, object prefix, transcript status) and nothing large.
  Drop the two chunk tables and their rows (D12) in the migration.
- **Statuses:** `recording → processing → ready`, or `failed`. Transcript has its own: `none | queued | running | ready |
failed | unavailable`. An asset is playable as soon as it is `ready`; the transcript arrives later.
- **Chapters:** computed at processing from the state track: one entry `{t, ref, heRef}` each time the leader's main text
  moves to another segment range, merged when under 3 seconds apart. They are the markers on the bar.
- **Access (D2):** `GET /api/v1/recordings/:id` and its manifest are public for anyone holding the unguessable id. Media
  is read through short-lived signed URLs the API hands out, which support range requests. Listing a room's assets still
  needs membership. Deleting needs the owner.
- **Idempotency:** finalising and processing are keyed on the asset id and safe to run twice (a unique row or an upsert,
  written in the same transaction as the status change). A second finalise is a no-op.

### 4.6 The player (D13)

- `/social/rec/:id` opens the reader with a **bar docked at the bottom** (not a floating window): play/pause, time, a
  seek bar with a marker per chapter, the ref in a tooltip while hovering or dragging, playback speed, hide/show video,
  and the transcript's current line under the bar (toggle).
- Dragging the bar seeks the media and applies the reader snapshot for that time (the state track already supports
  this). Clicking a marker jumps to that chapter.
- The talking head floats over the reader at the recorded position and can be hidden. Audio-only assets show no head.
- Works signed out, in both interface languages and directions, with the keyboard (space, arrows) and a screen reader
  (the seek bar is a slider with the current ref in its value text).
- The reader's bottom chrome and the room window must clear the bar (`useChromeInsets`).
- A share control copies the asset's link. Recordings made under the old storage are gone (D12).

### 4.7 Links in posts and live cards (D9)

- **Composer:** pasting or typing a room, broadcast or asset link (`/social/r/:id`, `/social/b/:id`, `/social/rec/:id`
  on an allowed origin) turns it at once into a card under the text, with a remove button; the browser's undo restores
  the plain link. One card per post in the first version.
- **Posts:** the post gets an optional `embed: {kind, id}`. The server checks the target exists. All other URLs in post
  text are rendered as links (`rel="noopener nofollow"`, http and https only). Add the field to the API only when present.
- **Card in the feed:** title, the leader's name, a Live badge, **the ref the session is on and that text**, and one
  button: Join (room), Watch (broadcast) or Play (asset). When it is not live it shows the last state or the asset.
- **Live status:** `GET /api/v1/live?ids=…` (at most 50 ids, public) answers `[{id, kind, live, ref, heRef, here,
updatedAt}]`. _Proposed mechanics:_ the relay (`packages/relay`) reports the leader's current ref to the app server
  over the existing internal HMAC channel (`RELAY_INTERNAL_SECRET`), only when it changes and at most once every 5
  seconds per room; the server keeps it in a small table and a 5-second in-memory cache. The feed polls every 15 seconds,
  only for cards on screen and only while the tab is visible, with `ETag` so an unchanged answer is a 304. No WebSocket.
  The card loads the text itself from the reader's text API, as feed cards do now.

## 5. Research results

### 5.1 Storage format

Not a zip: a browser cannot seek inside one, each part cannot be cached or signed separately, and adding the transcript
later means rewriting the archive. The usual shape is one folder per asset in object storage with a manifest. A zip can
be offered later as a download. WebVTT fits the transcript. HLS/DASH and container chapters are not needed.

A browser's MediaRecorder WebM has no duration and no seek index. One `ffmpeg -c copy` remux after the session fixes
that without re-encoding, and the same step extracts the audio.

### 5.2 Object storage (D11)

_Proposed:_ an S3-compatible client behind the existing `RecordingStore` seam, so production uses a GCS bucket (through
its S3-compatible endpoint or the GCS client), and local runs, e2e and the Coolify dev server use MinIO or a volume.
Credentials come from secrets, never from plain config in the repo; prefer workload identity over static keys where the
platform allows. Uploads keep going through the API in the first version (chunk → server → object); signed direct
uploads are a later optimisation.

### 5.3 Background jobs

**pg-boss**, in the server process, on the Postgres already there. No Redis, no Celery, no Python. Jobs:

| Job                 | Does                                                                                                              | Retry                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `asset.process`     | Concatenate chunks, ffmpeg remux, extract audio, compute chapters, write manifest, set `ready`                    | 3 tries, backoff with jitter |
| `transcript.submit` | Send `audio.m4a`'s signed URL to Sofer.ai, store its id                                                           | 3 tries, backoff             |
| `transcript.poll`   | Ask for status; reschedule itself (30 s, growing to 5 min, give up after 6 h); on completion store the transcript | Delayed job                  |

Each job uses the asset id as its singleton key, has a time limit on every outbound call and on ffmpeg, and can run
twice without harm. Install ffmpeg in the image from the distribution's pinned package, not from a downloaded script.

### 5.4 Transcription: Sofer.ai

- Docs: `https://docs.sofer.ai` (OpenAPI at `/openapi.json`). Keys are issued by e-mail to their support; **the owner
  needs to request one**. Secret: `SOFER_API_KEY`. Without it transcripts are `unavailable` and everything else works.
- `POST https://api.sofer.ai/v1/transcriptions/` with JSON: `info` and `audio_url` (a direct download URL). It queues on
  their side. **No webhook**: poll `GET /v1/transcriptions/{id}/status`, then `GET /v1/transcriptions/{id}` for `text`
  and word-level `timestamps[]`.
- Languages: `en, he, yi, fr`, with options for how Hebrew words are written. The leader picks the language when
  turning recording on, and in room settings; default per D10.
- $1.50 per audio hour. Limits: 5 requests a minute per key, 50 files an hour, 300 a day.
- Not confirmed in their docs: WebM input, maximum size and length. Send `audio.m4a`. Ask their support about limits.

## 6. Specs to write (next free number is 048)

Each is one spec with its own approval. Suggested PRs: A = 048–050, B = 051–053, C = 054, D = 055–056. A, B and D do
not depend on each other, except that 050 and 051 both change the recording controller: land 050 first.

| Spec | Title                                                                                                                     | Main places                                                                                                                        | Depends on            | Risk                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| 048  | Sticky following, a fixed leader, follow a person by their head                                                           | `packages/session`, `features/session`, `features/presence`, `features/av/Tiles.tsx`                                               | –                     | medium (protocol behaviour; reader contract untouched) |
| 049  | One press to get in: start lands in the room and the call; invitee Join does everything; no pre-join                      | `features/rooms/StartRoom.tsx`, `features/room/RoomLobbyPage.tsx`, `features/av`, `features/session/controller.ts`                 | –                     | medium                                                 |
| 050  | Session kinds and endings: start options, one Record toggle with pause and resume, Close / End / Finish, the closed state | `features/recording`, `features/session`, `features/broadcast`, `packages/relay`, rooms service                                    | 049                   | medium                                                 |
| 051  | The asset in object storage: leader-only capture, overlay track, manifest, public read, drop old recordings               | `server/services/recording-store.ts`, `recordings.ts`, schema + migration, `features/recording`, Helm values, Dockerfile, runbooks | 050                   | high (data, access rules, infra)                       |
| 052  | Processing: pg-boss, ffmpeg remux, audio, chapters, statuses                                                              | new `server/jobs/`, `app/scripts/start.mjs`, Dockerfile                                                                            | 051                   | high                                                   |
| 053  | The player: bottom bar, markers, hover ref, head at its recorded place, hide video, signed-out playback                   | `features/replay`                                                                                                                  | 051 (052 for markers) | medium                                                 |
| 054  | Transcript: Sofer.ai jobs, language choice, transcript line in the player                                                 | `server/jobs/`, `features/replay`, `features/recording`                                                                            | 052, 053              | medium                                                 |
| 055  | Links in posts: URLs become links; room, broadcast and asset links become cards                                           | `features/post`, posts service and contract, `packages/api-client`                                                                 | –                     | medium (API contract)                                  |
| 056  | Live cards: live status endpoint, relay reporting, polling, the card shows the current text                               | `packages/relay`, new route, `features/feed`, `features/post`                                                                      | 055                   | medium                                                 |

**Acceptance criteria to carry into the specs** (one line each; write them as Gherkin in `acceptance.feature`):

- **048:** a click on the room window, Join call or any Social control keeps `status: live`; moving 1–4 segments keeps it
  and the leader's next move re-aligns the follower; moving 5 segments or to another section sets `paused`; a non-owner
  cannot take the spotlight and sees no Lead button; clicking a person follows them; when the leader follows B, C (who
  follows the leader) ends at B's place.
- **049:** after Start the leader is in the room with the call connected, in one press after naming; an invitee's single
  Join ends with them a member, in the room's context, call connected, microphone and camera off, the leader's tile
  visible; no pre-join element exists; with calls off the same presses work.
- **050:** Record on → off → on → off yields one asset whose duration is the sum of the recorded stretches; Close room
  removes every participant and shows them it was closed; a follower's Leave affects only them; a broadcast's End shows
  viewers the ended state; the labels follow D15.
- **051:** a recording contains no remote participant's audio or video; an asset's page and media load signed out with
  its link; a member-only list stays member-only; old recordings are gone and their tables dropped; the head position
  track replays within 1% of the recorded place.
- **052:** processing twice produces one asset; the processed media reports its duration and seeks to the last second;
  a failed ffmpeg run ends as `failed` after 3 tries and keeps the raw chunks.
- **053:** markers match the manifest's chapters; hovering shows the ref; seeking applies the reader state for that time;
  hide video works; an audio-only asset shows no head; keyboard and screen-reader operation.
- **054:** with a key, a finished asset reaches transcript `ready` and the player shows the line for the current time;
  without a key it is `unavailable` and playback works; a Sofer.ai failure ends as `failed` without affecting the asset.
- **055:** pasting a room link makes a card and removing it restores text; a posted link is clickable; an unknown room id
  is refused; posts without an embed are byte-for-byte what they were.
- **056:** a live room's card shows the leader's ref within 20 seconds of a move; cards off screen and hidden tabs send
  no requests; 50 ids are answered in one request; the relay sends at most one report per room per 5 seconds.

## 7. What the owner must do

1. Done: sefaria-social#33 (upload fix and size budget) is merged and deployed. Record once on the dev server to confirm.
2. Approve each spec when its draft is ready (`npm run factory -- approve NNN --by …`).
3. Request a Sofer.ai API key and put it in the secrets as `SOFER_API_KEY`.
4. Create the bucket (or name an existing one) and give the social server access; say which environment gets which.
5. Still open from before: the minors decision for calls in production (D-AV4), the LiveKit webhook URL, and
   Sefaria-Project#4148 / #4152 with the contract re-pin.

## 8. Open points (proposals above, not yet confirmed)

- The 2-minute grace before a session ends when the leader disconnects (4.4).
- A closed room can host a new session; each session makes its own asset (4.4).
- One card per post in the first version (4.7).
- Whether a signed-out person who opens a **live** room or broadcast link may watch without signing in. D2 covers
  finished assets only; rooms need membership today, and broadcast viewing rules are in spec 043.
- How long raw chunks and assets are kept, and a size or length limit per asset (today 700 MB).
- Whether the leader may edit an asset afterwards (title, trim, delete the transcript, re-run it in another language).

## 9. Out of scope

Adaptive streaming, server-side recording (LiveKit Egress), editing or trimming, downloads as a zip, comments on an
asset, search inside transcripts, recording other participants, and several leaders.

## 10. QA pass at the end of each group

The session that built a group does not grade it. Run this as a separate pass (`/qa-plan`, `/qa-run`, or a fresh
subagent given only this section, the group's acceptance lines and the preview's address), against the PR's preview
(`docs/runbooks/previews.md`; the reader with `?social_version=<pr>`), with two browser contexts: a leader and a
follower.

- **A (048–050):** leader starts a room in one press after naming it; follower joins with one press and sees the
  leader's tile; follower clicks around Social's windows and stays following; follower moves 5 segments and is on their
  own, then Follow again; leader records, pauses, records, then closes the room; both see the closed state.
- **B (051–053):** the asset from A opens signed out; the bar seeks; markers show refs; the head is where the leader
  put it; hide video; an audio-only asset plays.
- **C (054):** with a key, the transcript appears and follows playback; without one, the asset still plays.
- **D (055–056):** a pasted room link becomes a card; the card shows the leader's current ref within 20 seconds of a
  move; a hidden tab sends no requests.

Record what was run, what passed, and every failure with its screenshot or trace in the PR and the progress file. A
failure reopens the spec; it is not waved through.
