# Plan: 034 join a room's call, choose devices, talk and leave, while the call survives reading

Design: `docs/design/audio-video.md` sections 4 (AV1–AV7) and 6.1, 6.3, 6.4. Needs spec 033's token endpoint. The window's look
and placement are spec 035; this spec renders the call as a plain panel in the persistent mount.

## Approach

**A media seam, so everything but one file is testable without WebRTC.** `features/av/media.ts` defines what the call needs
from a media library:

```ts
interface MediaEngine {
  listDevices(): Promise<{ audioInputs: Device[]; videoInputs: Device[] }>;
  preview(deviceId?: string): Promise<Preview>; // camera preview for the pre-join step
  connect(o: { url; token; mic; camera; audioDeviceId?; videoDeviceId? }): Promise<CallMedia>;
  canShareScreen(): boolean;
}
interface CallMedia {
  participants(): CallParticipant[]; // id, name, local, mic, camera, screen, speaking
  subscribe(cb): Unsubscribe;
  onConnection(cb: (s: "connected" | "reconnecting" | "disconnected") => void): Unsubscribe;
  setMicrophone(on);
  setCamera(on);
  setScreenShare(on);
  attach(participantId, source: "camera" | "screen", el: HTMLVideoElement): () => void;
  disconnect(): Promise<void>; // stops every local track
}
```

Device-permission failures surface as `MediaPermissionError`. `features/av/livekit-engine.ts` implements it with
`livekit-client` (pinned 2.23.0, the newest release over two weeks old; `adaptiveStream`, `dynacast`, simulcast). It is the only
file that imports `livekit-client`. `features/av/load-livekit.ts` is `() => import("./livekit-engine")`: a separate chunk that the
browser fetches only when the pre-join step opens (AC-003). Tests use `features/av/test-media.ts`, a fake engine that records
every call.

**The call machine** (`features/av/machine.ts`, AC-001), in the same style as `features/session/machine.ts`: the states
`off | prejoin | connecting | in-call | reconnecting | ended`, a `TRANSITIONS` table, and `transition()` that refuses anything not
in it. `in-call` carries `{ roomId, mic, camera, screen, switchTo? }`; `switchTo` is a pending "join another room's call" that
waits for confirmation (AC-008). `ended` carries the reason (`left | removed | room-closed | error`).

**The call controller** (`features/av/call-controller.ts`), one per host like `roomControllerFor`:

- `open(roomId)`: from `off` or `ended`, goes to `prejoin` and only then loads the engine and lists devices (AC-003). From
  `in-call` in another room, it sets `switchTo` instead; `confirmSwitch()` leaves the current call, then opens the pre-join step.
- `join(choices)`: `connecting`; gets a token from the API (`POST …/call/token`, a new `getCallToken` on `rooms-api.ts`); connects;
  takes a `"call"` hold on the room's session (`features/session/sessions.ts` gains the hold), so the room stays connected while
  the viewer reads anywhere (AV1, AV3); `in-call`; reports `av.join`.
- `leave()`: disconnects (every local track stopped), releases the hold, reports `av.leave` with `durationS` and
  `peakParticipants`, goes to `off`. The room is untouched (AC-007).
- Leaving the room ends the call first: the room controller gains `onLeave(cb)`, run at the start of `leave(roomId)` before
  its own holds are released (AC-007). `features/session` does not import `features/av`.
- `disconnected` from the engine, when the viewer did not leave: `reconnecting`, then a fresh token and a new connection,
  retried with backoff; after 30 seconds without success, `ended { reason: "error" }` with Rejoin (AC-011). LiveKit's own short
  reconnects show as `reconnecting` too.
- Reports (AC-012) carry only counts, durations and an error kind, never names, identities or device labels.

**The interface** (`features/av/`), rendered by the persistent mount so it survives every route change (R18):

- `CallButton`: "Join call" in the lobby (which has the room, so it knows `calls.available`) and in the follow bar (which asks
  the API for the room once, cached per host). Hidden when calls are not available (AC-002).
- `CallPanel` in `surface/persistent.tsx`, shown whenever the call is not `off`: `PreJoin` (microphone and camera off, device
  choosers, the preview once the camera is on, Join; on denied permission the way to allow it and "Join to listen", AC-004 and
  AC-005), `Tiles` and `Controls` (microphone, camera, screen share where supported, Leave, AC-006), the reconnecting line, the
  ended line with Rejoin, and the switch confirmation.
- A cold load with `ctx=social.room.<id>` reconnects the room as today and the follow bar offers "Join call"; nothing
  opens the call or asks for devices on its own (AC-010).
- Strings in English and Hebrew in `features/shell/strings.ts`.

## Risks

- The surface bundle budget (spec 019) cannot hold `livekit-client` (well over the 30 kB largest-chunk limit). The call chunk gets
  its own budget line in spec 040, task T-001, which is built straight after this spec; until then `npm run surface:budget` fails
  on this branch. Said in the PR.
- jsdom has no WebRTC, so audio and video playing for real (AC-006's "hears" and "sees") is proven in spec 040's two-browser
  journey. Here the panel is tested against the fake engine (tracks attached to elements, controls calling the engine).
- Autoplay: remote audio starts inside the Join click; a browser that still blocks it gets a "Start audio" button
  (`Room.startAudio()`).

## Test strategy

| AC                                                     | Test                                                                                                                                                                                                                                      | Why it fails today                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| AC-001                                                 | `features/av/machine.test.ts`: every state × event pair against the table                                                                                                                                                                 | no module (loaded through `import.meta.glob`, so the first assertion fails) |
| AC-007, AC-008, AC-011, AC-012                         | `features/av/call-controller.test.ts` with the fake engine, the fake host, the test relay and fake timers                                                                                                                                 | no module                                                                   |
| AC-002, AC-003, AC-004, AC-005, AC-006, AC-009, AC-010 | `surface/call.test.tsx` (jsdom): the lobby and the persistent mount with the fake host, the test relay, a fake rooms API and the fake engine; AC-003 also asserts the engine loader was never called and `getUserMedia` was never touched | no Join call button, no panel                                               |
