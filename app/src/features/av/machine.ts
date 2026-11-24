// The call lifecycle as a state machine (spec 034; design docs/design/audio-video.md section 4). Same style as
// features/session/machine.ts: the view is a discriminated union, every move goes through TRANSITIONS, and a move that is not
// in the table (or that its guard refuses) leaves the state unchanged. machine.test.ts checks every allowed and forbidden pair.
//
// A call belongs to one room (AV1) and is at most one per tab (AV2): opening another room's call while in one only records
// `switchTo`, and nothing changes until the viewer confirms. Microphone and camera start off on every pre-join (AV5).

export type Permission = "unknown" | "granted" | "denied";

/** What the viewer chose in the pre-join step. */
export interface DeviceChoice {
  mic: boolean;
  camera: boolean;
  audioDeviceId: string | null;
  videoDeviceId: string | null;
  permission: Permission;
}

export type EndReason = "removed" | "room-closed" | "error";

export type CallView =
  | { kind: "off" }
  | { kind: "prejoin"; roomId: string; devices: DeviceChoice }
  | { kind: "connecting"; roomId: string; mic: boolean; camera: boolean }
  | { kind: "in-call"; roomId: string; mic: boolean; camera: boolean; screen: boolean; switchTo: string | null }
  | { kind: "reconnecting"; roomId: string; mic: boolean; camera: boolean; since: number }
  | { kind: "ended"; roomId: string; reason: EndReason };

export type CallEvent =
  | { type: "open"; roomId: string } // Join call pressed
  | { type: "choose"; devices: DeviceChoice } // a change in the pre-join step
  | { type: "cancel" } // close the pre-join step
  | { type: "join" } // Join pressed in the pre-join step
  | { type: "connected" }
  | { type: "failed" } // could not connect, or gave up reconnecting
  | { type: "toggle"; mic?: boolean; camera?: boolean; screen?: boolean }
  | { type: "confirmSwitch" }
  | { type: "cancelSwitch" }
  | { type: "connectionLost"; at: number }
  | { type: "leave" } // the viewer left the call (or the room)
  | { type: "removed" } // the room's owner removed the viewer from the call (spec 039)
  | { type: "roomClosed" }
  | { type: "dismiss" };

export type CallKind = CallView["kind"];
export type CallEventType = CallEvent["type"];

export const CALL_KINDS: readonly CallKind[] = ["off", "prejoin", "connecting", "in-call", "reconnecting", "ended"];
export const CALL_EVENT_TYPES: readonly CallEventType[] = [
  "open",
  "choose",
  "cancel",
  "join",
  "connected",
  "failed",
  "toggle",
  "confirmSwitch",
  "cancelSwitch",
  "connectionLost",
  "leave",
  "removed",
  "roomClosed",
  "dismiss",
];

type Step<K extends CallKind, T extends CallEventType> = (
  state: Extract<CallView, { kind: K }>,
  event: Extract<CallEvent, { type: T }>,
) => CallView | string; // a string is the reason the move is refused

type Table = { [K in CallKind]: { [T in CallEventType]?: Step<K, T> } };

/** Every pre-join starts with everything off (AV5). */
export const prejoin = (roomId: string): CallView => ({
  kind: "prejoin",
  roomId,
  devices: { mic: false, camera: false, audioDeviceId: null, videoDeviceId: null, permission: "unknown" },
});

const off = (): CallView => ({ kind: "off" });

/** The allowed moves. Anything not listed here is forbidden. */
export const TRANSITIONS: Table = {
  off: {
    open: (_s, e) => prejoin(e.roomId),
  },
  prejoin: {
    choose: (s, e) => ({ ...s, devices: e.devices }),
    cancel: off,
    join: (s) => ({ kind: "connecting", roomId: s.roomId, mic: s.devices.mic, camera: s.devices.camera }),
  },
  connecting: {
    connected: (s) => ({ kind: "in-call", roomId: s.roomId, mic: s.mic, camera: s.camera, screen: false, switchTo: null }),
    failed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "error" }),
    leave: off,
    roomClosed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "room-closed" }),
  },
  "in-call": {
    open: (s, e) => (e.roomId === s.roomId ? "already in this room's call" : { ...s, switchTo: e.roomId }),
    toggle: (s, e) => ({ ...s, mic: e.mic ?? s.mic, camera: e.camera ?? s.camera, screen: e.screen ?? s.screen }),
    confirmSwitch: (s) => (s.switchTo ? prejoin(s.switchTo) : "no switch is waiting"),
    cancelSwitch: (s) => ({ ...s, switchTo: null }),
    connectionLost: (s, e) => ({ kind: "reconnecting", roomId: s.roomId, mic: s.mic, camera: s.camera, since: e.at }),
    leave: off,
    removed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "removed" }),
    roomClosed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "room-closed" }),
  },
  reconnecting: {
    connected: (s) => ({ kind: "in-call", roomId: s.roomId, mic: s.mic, camera: s.camera, screen: false, switchTo: null }),
    failed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "error" }),
    leave: off,
    removed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "removed" }),
    roomClosed: (s) => ({ kind: "ended", roomId: s.roomId, reason: "room-closed" }),
  },
  ended: {
    open: (_s, e) => prejoin(e.roomId),
    dismiss: off,
  },
};

export type TransitionResult = { ok: true; state: CallView } | { ok: false; state: CallView; reason: string };

/** Applies `event` to `state`. A move that is not in TRANSITIONS (or that its guard refuses) returns the state unchanged. */
export function transition(state: CallView, event: CallEvent): TransitionResult {
  const step = (TRANSITIONS[state.kind] as Record<string, Step<CallKind, CallEventType> | undefined>)[event.type];
  if (!step) return { ok: false, state, reason: `"${event.type}" is not allowed in "${state.kind}"` };
  const next = step(state as never, event as never);
  return typeof next === "string" ? { ok: false, state, reason: next } : { ok: true, state: next };
}

export const INITIAL_CALL: CallView = { kind: "off" };

/** The room whose call this is, or null when there is none. */
export const callRoom = (v: CallView): string | null => (v.kind === "off" ? null : v.roomId);
