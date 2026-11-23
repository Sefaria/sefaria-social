// The enlarge / minimise state machine (plan 4.3): every allowed and every forbidden transition. Loaded through
// import.meta.glob so each test fails on an assertion where the module does not exist (prove-red).
import { describe, expect, it } from "vitest";
import type { ReaderSnapshot } from "@sefaria-social/host-contract";

const modules = import.meta.glob<typeof import("./machine")>("./machine.ts");
async function load() {
  const mod = await modules["./machine.ts"]?.();
  expect(mod, "app/src/features/session/machine.ts exists").toBeDefined();
  return mod!;
}

type M = typeof import("./machine");
type View = import("./machine").SessionView;
type Event = import("./machine").SessionEvent;

const room = { kind: "room", id: "room-00001" } as const;
const otherRoom = { kind: "room", id: "room-00002" } as const;
const own: ReaderSnapshot = { v: 1, url: "/Genesis.1", nav: null, slices: {} };

/** One representative state of each kind. */
const STATES: Record<View["kind"], View> = {
  idle: { kind: "idle" },
  card: { kind: "card", source: room },
  entering: { kind: "entering", target: room, ownPlace: own },
  expanded: { kind: "expanded", context: room, ownPlace: own, following: true },
  detached: { kind: "detached", context: room, ownPlace: own },
  leaving: { kind: "leaving", context: room, returnTo: "/social/r/room-00001" },
};

/** One representative event of each type. */
const EVENTS: Record<Event["type"], Event> = {
  showCard: { type: "showCard", source: otherRoom },
  dismiss: { type: "dismiss" },
  enlarge: { type: "enlarge", target: room, ownPlace: own },
  contextReady: { type: "contextReady", context: room },
  enterFailed: { type: "enterFailed", reason: "snapshot refused" },
  stopFollowing: { type: "stopFollowing" },
  startFollowing: { type: "startFollowing" },
  detach: { type: "detach" },
  rejoin: { type: "rejoin" },
  minimise: { type: "minimise", returnTo: "/social/r/room-00001" },
  contextLost: { type: "contextLost" },
  left: { type: "left" },
};

/** The allowed moves and the state each one leads to. Every pair not listed must be refused. */
const ALLOWED: Record<string, View> = {
  "idle/showCard": { kind: "card", source: otherRoom },
  "idle/enlarge": { kind: "entering", target: room, ownPlace: own },
  "card/showCard": { kind: "card", source: otherRoom },
  "card/dismiss": { kind: "idle" },
  "card/enlarge": { kind: "entering", target: room, ownPlace: own },
  "entering/contextReady": { kind: "expanded", context: room, ownPlace: own, following: true },
  "entering/enterFailed": { kind: "idle" },
  "entering/contextLost": { kind: "idle" },
  "expanded/stopFollowing": { kind: "expanded", context: room, ownPlace: own, following: false },
  "expanded/startFollowing": { kind: "expanded", context: room, ownPlace: own, following: true },
  "expanded/detach": { kind: "detached", context: room, ownPlace: own },
  "expanded/minimise": { kind: "leaving", context: room, returnTo: "/social/r/room-00001" },
  "expanded/contextLost": { kind: "idle" },
  "detached/rejoin": { kind: "expanded", context: room, ownPlace: own, following: true },
  "detached/minimise": { kind: "leaving", context: room, returnTo: "/social/r/room-00001" },
  "detached/contextLost": { kind: "idle" },
  "leaving/left": { kind: "idle" },
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

describe("session state machine", () => {
  // @feature SESS-002 Enlarge and minimise session state machine
  // @ac 004/AC-001
  it("allows every move in the table and reaches the expected state", async () => {
    const m = await load();
    const results = Object.fromEntries(ALLOWED_PAIRS.map((pair) => [pair, run(m, pair)]));
    expect(results).toEqual(Object.fromEntries(ALLOWED_PAIRS.map((pair) => [pair, { ok: true, state: ALLOWED[pair] }])));
  });

  // @feature SESS-002 Enlarge and minimise session state machine
  // @ac 004/AC-002
  it("refuses every move not in the table and leaves the state unchanged", async () => {
    const m = await load();
    const results = Object.fromEntries(FORBIDDEN_PAIRS.map((pair) => [pair, run(m, pair)]));
    const expected = Object.fromEntries(
      FORBIDDEN_PAIRS.map((pair) => [
        pair,
        { ok: false, state: STATES[pair.split("/")[0] as View["kind"]], reason: expect.any(String) },
      ]),
    );
    expect(FORBIDDEN_PAIRS.length).toBe(72 - 17);
    expect(results).toEqual(expected);
  });

  // @feature SESS-002 Enlarge and minimise session state machine
  // @ac 004/AC-003
  it("only reaches expanded when the reader's context is the one being entered (R9 step 4)", async () => {
    const m = await load();
    expect(m.transition(STATES.entering, { type: "contextReady", context: otherRoom })).toEqual({
      ok: false,
      state: STATES.entering,
      reason: "the reader's context is not the one being entered",
    });
  });

  // @feature SESS-002 Enlarge and minimise session state machine
  // @ac 004/AC-001
  it("covers every state and event: the table in the module and this test list the same kinds and events", async () => {
    const m = await load();
    expect([...m.SESSION_KINDS].sort()).toEqual(Object.keys(STATES).sort());
    expect([...m.SESSION_EVENT_TYPES].sort()).toEqual(Object.keys(EVENTS).sort());
    expect(Object.keys(m.TRANSITIONS).sort()).toEqual(Object.keys(STATES).sort());
    const tablePairs = Object.entries(m.TRANSITIONS).flatMap(([k, row]) => Object.keys(row).map((t) => `${k}/${t}`));
    expect(tablePairs.sort()).toEqual([...ALLOWED_PAIRS].sort());
  });
});
