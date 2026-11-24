// The call state machine (spec 034 AC-001): every allowed and every forbidden transition. Loaded through import.meta.glob so
// each test fails on an assertion where the module does not exist (prove-red).
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./machine")>("./machine.ts");
async function load() {
  const mod = await modules["./machine.ts"]?.();
  expect(mod, "app/src/features/av/machine.ts exists").toBeDefined();
  return mod!;
}

type M = typeof import("./machine");
type View = import("./machine").CallView;
type Event = import("./machine").CallEvent;

const R = "room-00001";
const S = "room-00002";
const OFF = { mic: false, camera: false };
const devices = { mic: false, camera: true, audioDeviceId: null, videoDeviceId: "cam-1", permission: "granted" as const };

/** One representative state of each kind. */
const STATES: Record<View["kind"], View> = {
  off: { kind: "off" },
  prejoin: { kind: "prejoin", roomId: R, devices: { ...OFF, audioDeviceId: null, videoDeviceId: null, permission: "unknown" } },
  connecting: { kind: "connecting", roomId: R, mic: false, camera: true },
  "in-call": { kind: "in-call", roomId: R, mic: true, camera: false, screen: false, switchTo: S },
  reconnecting: { kind: "reconnecting", roomId: R, mic: true, camera: false, since: 1000 },
  ended: { kind: "ended", roomId: R, reason: "error" },
};

/** One representative event of each type. */
const EVENTS: Record<Event["type"], Event> = {
  open: { type: "open", roomId: S },
  choose: { type: "choose", devices },
  cancel: { type: "cancel" },
  join: { type: "join" },
  connected: { type: "connected" },
  failed: { type: "failed" },
  toggle: { type: "toggle", camera: true },
  confirmSwitch: { type: "confirmSwitch" },
  cancelSwitch: { type: "cancelSwitch" },
  connectionLost: { type: "connectionLost", at: 5000 },
  leave: { type: "leave" },
  removed: { type: "removed" },
  roomClosed: { type: "roomClosed" },
  dismiss: { type: "dismiss" },
};

const fresh = (roomId: string) => ({
  kind: "prejoin" as const,
  roomId,
  devices: { mic: false, camera: false, audioDeviceId: null, videoDeviceId: null, permission: "unknown" as const },
});

/** The allowed moves and the state each one leads to. Every pair not listed must be refused. */
const ALLOWED: Record<string, View> = {
  "off/open": fresh(S),
  "prejoin/choose": { kind: "prejoin", roomId: R, devices },
  "prejoin/cancel": { kind: "off" },
  "prejoin/join": { kind: "connecting", roomId: R, mic: false, camera: false },
  "connecting/connected": { kind: "in-call", roomId: R, mic: false, camera: true, screen: false, switchTo: null },
  "connecting/failed": { kind: "ended", roomId: R, reason: "error" },
  "connecting/leave": { kind: "off" },
  "connecting/roomClosed": { kind: "ended", roomId: R, reason: "room-closed" },
  "in-call/open": { kind: "in-call", roomId: R, mic: true, camera: false, screen: false, switchTo: S },
  "in-call/toggle": { kind: "in-call", roomId: R, mic: true, camera: true, screen: false, switchTo: S },
  "in-call/confirmSwitch": fresh(S),
  "in-call/cancelSwitch": { kind: "in-call", roomId: R, mic: true, camera: false, screen: false, switchTo: null },
  "in-call/connectionLost": { kind: "reconnecting", roomId: R, mic: true, camera: false, since: 5000 },
  "in-call/leave": { kind: "off" },
  "in-call/removed": { kind: "ended", roomId: R, reason: "removed" },
  "in-call/roomClosed": { kind: "ended", roomId: R, reason: "room-closed" },
  "reconnecting/connected": { kind: "in-call", roomId: R, mic: true, camera: false, screen: false, switchTo: null },
  "reconnecting/failed": { kind: "ended", roomId: R, reason: "error" },
  "reconnecting/leave": { kind: "off" },
  "reconnecting/removed": { kind: "ended", roomId: R, reason: "removed" },
  "reconnecting/roomClosed": { kind: "ended", roomId: R, reason: "room-closed" },
  "ended/open": fresh(S),
  "ended/dismiss": { kind: "off" },
};

const PAIRS = (Object.keys(STATES) as View["kind"][]).flatMap((k) =>
  (Object.keys(EVENTS) as Event["type"][]).map((t) => `${k}/${t}`),
);
const ALLOWED_PAIRS = PAIRS.filter((p) => p in ALLOWED);
const FORBIDDEN_PAIRS = PAIRS.filter((p) => !(p in ALLOWED));

const run = (m: M, pair: string) => {
  const [kind, type] = pair.split("/") as [View["kind"], Event["type"]];
  return m.transition(STATES[kind], EVENTS[type]);
};

describe("call state machine", () => {
  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-001
  it("allows every move in the table and reaches the expected state", async () => {
    const m = await load();
    const results = Object.fromEntries(ALLOWED_PAIRS.map((pair) => [pair, run(m, pair)]));
    expect(results).toEqual(Object.fromEntries(ALLOWED_PAIRS.map((pair) => [pair, { ok: true, state: ALLOWED[pair] }])));
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-001
  it("refuses every move not in the table and leaves the state unchanged", async () => {
    const m = await load();
    const results = Object.fromEntries(FORBIDDEN_PAIRS.map((pair) => [pair, run(m, pair)]));
    const expected = Object.fromEntries(
      FORBIDDEN_PAIRS.map((pair) => [
        pair,
        { ok: false, state: STATES[pair.split("/")[0] as View["kind"]], reason: expect.any(String) },
      ]),
    );
    expect(FORBIDDEN_PAIRS.length).toBe(6 * 14 - 23);
    expect(results).toEqual(expected);
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-001
  it("guards the moves whose meaning depends on the state", async () => {
    const m = await load();
    const inCall = STATES["in-call"] as Extract<View, { kind: "in-call" }>;
    // opening the call you are in is not a switch
    expect(m.transition(inCall, { type: "open", roomId: R }).ok).toBe(false);
    // confirming a switch nobody asked for does nothing
    expect(m.transition({ ...inCall, switchTo: null }, { type: "confirmSwitch" }).ok).toBe(false);
    // joining keeps the choices made in the pre-join step, never more
    expect(
      m.transition({ kind: "prejoin", roomId: R, devices: { ...devices, mic: true, camera: false } }, { type: "join" }),
    ).toEqual({ ok: true, state: { kind: "connecting", roomId: R, mic: true, camera: false } });
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-001
  it("covers every state and event: the table in the module and this test list the same kinds and events", async () => {
    const m = await load();
    expect([...m.CALL_KINDS].sort()).toEqual(Object.keys(STATES).sort());
    expect([...m.CALL_EVENT_TYPES].sort()).toEqual(Object.keys(EVENTS).sort());
    expect(Object.keys(m.TRANSITIONS).sort()).toEqual(Object.keys(STATES).sort());
    const tablePairs = Object.entries(m.TRANSITIONS).flatMap(([k, row]) => Object.keys(row).map((t) => `${k}/${t}`));
    expect(tablePairs.sort()).toEqual([...ALLOWED_PAIRS].sort());
  });
});
