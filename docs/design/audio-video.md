# Sefaria Social: live audio and video in the reader (architecture spec, draft)

Status: draft for the owner's review, 2026-11-24. Nothing here is decided until the owner says so; section 9 lists the
decisions. The work is specified in specs 033–040 (section 8). Plan references (`PLAN §…`) are to `docs/PLAN.md`.

## 1. The ask

People in a live session (a social room, later a live shiur) can see and hear each other, Google Meet style, while they keep
learning in the reader. The video is a **floating box over the reader**: default position top right, the user can drag it,
resize it, and make it smaller or larger. Audio streams too. LiveKit is the media provider.

## 2. The answer in one paragraph

**Yes, A/V is a module of the live session, not a new system.** It is one feature folder in social (`features/av`) that
attaches to the room session social already has: same room id, same membership check, same identity token, same persistent
mount that survives navigation. The things that make it more than "call the LiveKit API" are few and bounded, and all of them
sit at existing seams:

1. **A token endpoint on the social server** that turns "this Sefaria user is a member of this room" into a LiveKit access
   token with the right grants. Media servers never see the Django token, and social never shares a secret with the browser.
2. **A second, separate connection per room.** State (follow, presence, chat) stays on the existing relay; media goes to
   LiveKit. They are independent, so a failed call never breaks following, and the relay protocol shared with the reader is
   untouched.
3. **A floating window in the persistent mount**, plus one optional addition to the host contract (minor 1.2) so the window
   can avoid the reader's header and side panel.
4. **Roles and moderation** (who may publish, who may mute or remove), which rooms do not need today but calls do.
5. **Lazy loading**, so readers who never join a call download none of the LiveKit code.

Nothing in the reader changes except the optional contract addition. Nothing in Django changes.

## 3. Where it sits

```
 browser, one document (reader-next, social lab on)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ reader shell: header, <main> (panels), side panel                            │
 │                                                                              │
 │  social persistent mount (beside <main>, survives navigation)                │
 │   ├─ FollowBar / MiniView                 (exists)                           │
 │   └─ CallWindow  ← new, position: fixed, floats over the reader              │
 │        ├─ video tiles, speaking ring, mute/camera/leave                      │
 │        └─ lazy chunk: livekit-client                                         │
 └───────┬─────────────────────────────┬───────────────────────────┬────────────┘
         │ HTTPS + Django token        │ WSS (state)               │ WSS + WebRTC (media)
         ▼                             ▼                           ▼
   SOCIAL SERVER                  RELAY (Cloudflare DO)        LIVEKIT (Cloud, or self-hosted later)
   POST /rooms/{id}/call/token    state, presence, chat        SFU: audio, video, screen share
   POST /livekit/webhook  ◀──────────────────────────────────── signed webhooks (joined, left, room finished)
   moderation via LiveKit server API ─────────────────────────▶
```

### 3.1 Why not route media through the relay

The relay is a Durable Object that fans out small JSON frames (16 KB, 20 state messages per second). Audio and video need an
SFU with WebRTC, congestion control, simulcast and TURN. That is LiveKit's job. Signalling also stays on LiveKit's own
connection: re-implementing it over the relay would fork LiveKit's client and buy nothing.

### 3.2 Why not move state onto LiveKit data channels

LiveKit can carry data messages, so the relay could in principle go away. Not now: the relay's protocol is shared with the
reader and pinned by recorded fixtures (decision 0007), it works without anyone being in a call, cards read its status, and
most rooms will be used without A/V. Revisit at P6, when follow moves fully into social; by then the question is "one vendor
or two" rather than a protocol rewrite.

## 4. The session model

A/V is an optional layer of a room session, with its own state machine that never changes the room's.

```ts
// features/av/machine.ts — same style as features/session/machine.ts: a discriminated union and a tested transition table.
type CallView =
  | { kind: "off" } // in the room (or not), no call
  | { kind: "prejoin"; roomId: RoomId; devices: DeviceChoice } // device check, preview, mic/camera off by default
  | { kind: "connecting"; roomId: RoomId }
  | { kind: "in-call"; roomId: RoomId; mic: boolean; camera: boolean; window: WindowState }
  | { kind: "reconnecting"; roomId: RoomId; since: number }
  | { kind: "ended"; roomId: RoomId; reason: "left" | "removed" | "room-closed" | "error" };
```

Rules:

- **AV1.** A call belongs to one room and needs an open room session for that room. Leaving the room leaves the call. Leaving
  the call does not leave the room.
- **AV2.** At most one call per tab. Joining another room's call leaves the current one first, after a confirmation.
- **AV3.** The call survives every in-reader navigation, because it lives in the persistent mount (R18 already guarantees that
  mount does not unmount on route change). Minimise and enlarge (R9, R12) do not touch it.
- **AV4.** A full page load ends the call. On a cold load with `ctx=social.room.<id>`, the room reconnects (R11) and the call
  window offers **Rejoin call**; it never rejoins on its own. Browsers block audio without a user gesture, and turning a
  camera on without a click would be a privacy fault.
- **AV5.** Mic and camera start **off** on every join. The pre-join step shows a preview and lets the user choose devices.
- **AV6.** Nothing the reader does can end a call except leaving the document. Nothing the call does can affect the reader's
  state or URL. The call is never part of a snapshot, a `ctx` value or a share link (R14).
- **AV7.** Exits: with a call live, any navigation that would leave reader-next (a Django page, an external link) asks first.
  This leans on the existing rule that social never links to the legacy client; the ask is for the remaining cases.

## 5. Server side

### 5.1 Token endpoint

`POST /api/v1/rooms/{roomId}/call/token`, protected by default like every other route (PLAN §6.1).

1. Verify the Django token (existing middleware).
2. Check membership in `room_members` (404 for non-members, as `GET /rooms/{id}` does).
3. Decide the grants from the role (5.2).
4. Return `{ url, token, expiresAt }`. The token is a LiveKit access token (`livekit-server-sdk` `AccessToken`) with
   `identity = "u:<sefaria user id>"`, `name` from the display cache, `room = "room_<roomId>"`, a TTL of 10 minutes, and
   metadata `{ v: 1, role }`. LiveKit only checks the token at join, so the short TTL does not cut a live call; the client
   fetches a fresh token to reconnect.

The LiveKit API key and secret live only on the social server (env, like `RELAY_INTERNAL_SECRET`). The browser never holds
them. Identity is the Sefaria user id, never the hashed username (PLAN §6.1).

### 5.2 Roles and grants

| Kind of session                 | Who publishes                                        | LiveKit grants                                                                           |
| ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Room (small group, Meet style)  | Every member                                         | `canPublish` (microphone, camera, screen share), `canSubscribe`, `canPublishData: false` |
| Live shiur (one to many, later) | Teacher and invited speakers; others listen          | Speaker as above; listener `canPublish: false`, `canSubscribe: true`                     |
| Room owner, either kind         | Everything above, plus moderation through the server | Same grants; moderation is a server call, not a client grant                             |

`canPublishData` is off because chat and state stay on the relay (3.2); that keeps one moderated channel for text.

Decision 0008 lets everyone lead a room's reading. Media is different: someone must be able to mute or remove a participant.
The room `owner` row already exists in `room_members`; moderation is owner-only and goes through the server:

- `POST /api/v1/rooms/{roomId}/call/mute { participant, track }` and `POST …/call/remove { participant }`: check that the
  caller owns the room, then call LiveKit's `RoomServiceClient` (`mutePublishedTrack`, `removeParticipant`).
- Removing a participant from the call does not remove them from the room. "Remove from room" (not built yet) does both.

### 5.3 Webhooks

`POST /api/v1/internal/livekit/webhook`, verified with `WebhookReceiver` (signed with the same API key), idempotent through
`webhook_receipts`. Used for:

- **Call status for cards and the lobby:** `participant_joined` / `participant_left` / `room_finished` update an in-memory or
  small table `call_status (room_id, participants, started_at)`, so a card can say "3 on a call" without opening a socket
  (PLAN §4.5). The relay's status read is extended with this field, or the server joins the two.
- **Account deletion:** `user-deleted` (PLAN §6.3) also calls `removeParticipant` for that identity in any live room.
  Social stores no media, so there is nothing else to delete until recording exists.

### 5.4 Hosting

|                | LiveKit Cloud                                | Self-hosted LiveKit                                                                                           |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Work           | An account and two env values                | A server with open UDP ports (or TURN over TLS 443), TURN, Redis for more than one node, upgrades, monitoring |
| Fits our infra | Yes; nothing to run                          | Poorly on Coolify; on GKE needs host networking or a UDP load balancer                                        |
| Cost           | Per participant minute and egress            | Machines and bandwidth, plus people's time                                                                    |
| Lock-in        | None in code: the same SDKs and token format |                                                                                                               |

Recommendation: start on **LiveKit Cloud** for staging and the first production users, behind the lab gate. The code is the
same either way, so moving to self-hosted later is a change of `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.

## 6. Client side

### 6.1 Code layout

```
app/src/features/av/
  machine.ts            CallView union + transition table (tested like session/machine.ts)
  call-controller.ts    one per host, like controller.ts: owns the LiveKit Room object, token refresh, device state
  load-livekit.ts       dynamic import("livekit-client"); the only module that names it
  CallWindow.tsx        the floating window (6.2), rendered by PersistentView
  PreJoin.tsx           device preview and choice
  Tiles.tsx             video tiles, active speaker, audio-only avatars
  Controls.tsx          mic, camera, screen share, leave, layout, owner menu
  window-geometry.ts    pure functions: default placement, clamping, snapping, saved position (unit-tested)
app/src/server/services/livekit.ts   token minting, moderation, webhook verification
app/src/routes/api/v1/rooms.$roomId.call.*.ts
```

Use `livekit-client` directly and keep our own small components rather than `@livekit/components-react`. Our tiles must match
the reader's design tokens and the surface's bundle budget (spec 019); the components package brings its own styles and
weight. Revisit if the custom code grows past a few hundred lines.

**Bundle:** `livekit-client` is loaded only when the user opens the pre-join step. The entry chunk gains only the call
button and the window shell. Spec 019's budget gets a separate line for the A/V chunk.

### 6.2 The floating window

It renders inside the persistent mount with `position: fixed`, so it floats over the reader and takes no layout space. The
reader's text column, side panel and scroll position never move because of it.

**Sizes.** Three sizes plus a minimised pill:

| Size            | What it shows                                                                     |
| --------------- | --------------------------------------------------------------------------------- |
| Pill            | Avatars of who is on the call, speaking ring, mic toggle, expand. About 240 × 48. |
| Small (default) | Active speaker large, others as a strip. About 320 × 200.                         |
| Medium          | Grid of up to 4. About 480 × 300.                                                 |
| Large           | Grid of up to 9. Up to 60 % of the viewport.                                      |

Free resize from the corner handle between Small's minimum and Large's maximum, keeping a 16:10 ratio for the tile area.
The size buttons jump between the presets.

**Placement.**

- Default: top, at the inline end (right in English, left in Hebrew interface; see D-AV5), 16 px from the edge, below the
  reader's header.
- When the reader's side panel (connections) is open on that side, the default moves to sit beside it, not over it.
- The user can drag it anywhere. It snaps to the nearest corner on release, and is always clamped inside the viewport
  (re-clamped on resize, on size change, and when the side panel opens or closes).
- The position is saved per viewer in `localStorage` as `{ corner, offsetX, offsetY, size }`, relative to the corner, so it
  survives different window sizes. Wrapped in try/catch; the default is used when storage is missing.

**What it needs from the reader.** The window must know where the header ends and where the side panel is. Two ways:

- **Contract 1.2 (preferred):** an optional `host.ui.chrome` member: `get(): { top: number; inlineEnd: number;
inlineStart: number; bottom: number }` (the reader's occupied insets in CSS px) and `subscribe(cb)`. A minor version adds
  optional members only, so a reader without it still works: the surface falls back to fixed offsets.
- **Without a contract change:** measure the reader's DOM. Rejected: it couples social to the reader's markup, which the
  contract exists to prevent (PLAN §1.2 point 3).

**Interaction and accessibility.**

- Drag from a real `<button>` handle (the title bar), not from the video, so clicks on tiles and controls still work. Use
  pointer capture; move with `transform` during the drag and commit the position on release.
- Keyboard: the handle moves the window with the arrow keys (16 px per press, 64 with Shift) and has a menu with "Move to
  top right / top left / bottom right / bottom left" and the sizes. This is the single-pointer alternative WCAG requires.
  Moves are announced in a polite live region.
- It is non-modal: no focus trap; Escape collapses to the pill rather than leaving.
- Controls are at least 24 × 24 px with visible `:focus-visible` rings; every control has a text label for screen readers.
- `prefers-reduced-motion`: no animated snapping or size transitions.
- Captions are not in the first version (section 7); the window reserves space for them.

**Phones.** No free drag. Under the reader's phone breakpoint the window is a docked strip at the top (pill height by
default, tap to expand to a 16:9 active-speaker view), and a swipe or button hides it to the pill. Background audio on iOS
Safari stops when the tab is hidden; the window says so on return and offers Rejoin.

**Later:** "Pop out" to the Document Picture-in-Picture API where the browser supports it (Chrome), so the call can float
over other apps.

### 6.3 Media handling

- Adaptive stream and dynacast on (LiveKit options), simulcast on for camera. Tiles not visible (pill, hidden strip) are
  unsubscribed from video and keep audio.
- Audio plays through one `<audio>` element per remote participant, created after a user gesture (the Join click).
- Device changes (`devicechange`), permission denial and a lost device all land in the state machine with clear messages;
  denial never ends the room session.
- Speaking indicators come from LiveKit's active-speaker events; the reader's presence list can show a speaking ring too,
  through social's own presence UI (no reader change).

### 6.4 Errors and analytics

Through `host.report` (exists): `av.join`, `av.leave` (duration, peak participants), `av.error` (kind, never media or
device labels), `av.reconnect`. No names, no device labels, no IP data in events.

## 7. Out of scope for the first version

- Recording (LiveKit Egress) and recorded shiurim with video. Needs a consent and retention policy first.
- Live captions and transcription (LiveKit Agents with a speech-to-text provider). Wanted for accessibility; second version.
- Breakout rooms, hand raise, reactions, background blur.
- Calls in the legacy client. Social reaches only reader-next users (PLAN §1.3).
- Native apps.

## 8. Work items (specs 033–040)

| #   | Spec                                                                                                     | Depends on   |
| --- | -------------------------------------------------------------------------------------------------------- | ------------ |
| 033 | `call-token-and-roles`: LiveKit configuration, token endpoint, roles to grants, protected by default     | D-AV1, D-AV2 |
| 034 | `join-a-call`: call state machine and controller, lazy LiveKit load, pre-join with devices off, controls | 033          |
| 035 | `floating-call-window`: sizes, drag, resize, snap, saved position, keyboard and screen reader            | 034          |
| 036 | `host-chrome-insets`: SurfaceHost 1.2 `ui.chrome` (needs a reader PR in Sefaria-Project)                 | reader owner |
| 037 | `call-on-phones`: docked strip                                                                           | 035          |
| 038 | `call-status-and-webhooks`: webhooks, call status on cards and lobby, deletion removes from live calls   | 033          |
| 039 | `call-moderation`: owner mutes and removes                                                               | 033, D-AV3   |
| 040 | `call-budget-and-e2e`: A/V chunk budget, e2e lane with fake media and a local LiveKit                    | 034          |

Spec 032 (a live shiur from a follow-me link) is separate work in progress; shiur roles for calls come after it.

Testing: unit tests for the machine and window geometry; component tests for the window with a fake controller; e2e in
Playwright with Chromium's `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` against a local
LiveKit server (`livekit-server --dev` in the e2e stack, next to `wrangler dev`). Two-browser journeys: A and B join, B sees
A's tile, A mutes, B sees muted, A navigates to another ref and the call stays up.

## 9. Decisions for the owner

| #     | Question                                          | Proposed default                                                                                                               |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D-AV1 | LiveKit Cloud or self-hosted to start             | Cloud, behind the social lab gate; self-host later if cost requires                                                            |
| D-AV2 | Who may publish in a room                         | Every member; owners can mute and remove                                                                                       |
| D-AV3 | Moderation beyond mute and remove (block, report) | Not in v1; links to the moderation work already blocking P7                                                                    |
| D-AV4 | Minors and calls                                  | **No default.** Same open policy question that blocks chat (PLAN §9); calls should not ship to all users before it is answered |
| D-AV5 | Default corner in the Hebrew interface            | Top left (inline end), mirroring English                                                                                       |
| D-AV6 | Size cap on a room call                           | 12 publishers with video; more join audio only                                                                                 |
| D-AV7 | Retire the relay for LiveKit data at P6           | Decide at P6                                                                                                                   |

## 10. Checks before building

- `[CHECK]` the current `livekit-client` and `livekit-server-sdk` versions and their token and webhook APIs at the time of
  spec 033.
- `[CHECK]` that nothing in front of reader-next (Cloudflare, nginx) sets a `Permissions-Policy` that blocks `camera` or
  `microphone`, or a CSP `connect-src` that blocks the LiveKit `wss:` host. Neither header is set in reader-next today.
- `[CHECK]` spec 019's measured sizes after adding the call button to the entry chunk.
