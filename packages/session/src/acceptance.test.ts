// Acceptance tests for spec 009 (room protocol and client). The modules are loaded through import.meta.glob so that, on a
// base without packages/session, the first assertion fails (prove-red) instead of the import.
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as RoomModule from "./room";
import type * as ClientModule from "./client";
import type * as MemoryModule from "./core/transports/memory";
import type * as WebSocketModule from "./core/transports/websocket";
import type { ApplyContext, ReaderSnapshot, ReaderStateApi, SnapshotChange } from "./core/types";
import type { AnyEnvelope } from "./protocol";

const roomModules = import.meta.glob<typeof RoomModule>("./room.ts");
const clientModules = import.meta.glob<typeof ClientModule>("./client.ts");
const memoryModules = import.meta.glob<typeof MemoryModule>("./core/transports/memory.ts");
const wsModules = import.meta.glob<typeof WebSocketModule>("./core/transports/websocket.ts");

async function loadRoom(): Promise<typeof RoomModule> {
  const mod = await roomModules["./room.ts"]?.();
  expect(mod, "packages/session/src/room.ts exists").toBeDefined();
  return mod!;
}

const join = (id: string) => ({ ch: "control", body: { type: "join", participant: { id, isHost: true, canLead: true } } });
const keyframe = (seq: number, url: string) => ({
  ch: "state",
  body: { type: "keyframe", seq, t: seq, snapshot: { v: 1, url, nav: null, slices: {} } },
});
const change = (seq: number, url: string) => ({ ch: "state", body: { type: "change", seq, t: seq, change: { url } } });

describe("spec 009: the room", () => {
  // @feature SESS-009 Room protocol and client in packages/session
  // @ac 009/AC-001
  it("drops oversized frames, rate-limits state, stamps from/seq/t/term itself and refuses a 201st participant", async () => {
    const { createRoom, KEYFRAMES_PER_SECOND } = await loadRoom();
    let clock = 10_000;
    const room = createRoom({ now: () => clock });
    room.connect("leader");
    room.connect("follower");
    room.handle("leader", join("leader"));
    room.handle("follower", join("follower"));

    // A frame over 16 384 bytes is dropped before parsing.
    const huge = JSON.stringify({
      ch: "state",
      body: { type: "change", seq: 1, t: 1, change: { url: "/" + "x".repeat(16_400) } },
    });
    expect(room.handle("leader", huge)).toEqual([]);

    // The keyframe is relayed with the room's own "from", "t" and "term", whatever the client wrote.
    const forged = { ...keyframe(0, "/Genesis.1"), from: "someone-else", seq: 99, t: 1, term: 42 };
    const relayed = room.handle("leader", forged);
    expect(relayed.map((o) => ({ to: o.to, from: o.envelope.from, t: o.envelope.t, term: o.envelope.term }))).toEqual([
      { to: { except: "leader" }, from: "leader", t: 10_000, term: 1 },
    ]);
    expect(KEYFRAMES_PER_SECOND).toBeGreaterThan(0);

    // 20 state messages a second are relayed; the 21st and later in the same second are not.
    clock += 1_000;
    const counts = Array.from({ length: 22 }, (_, i) => room.handle("leader", change(i + 1, `/Genesis.${i + 2}`)).length);
    expect(counts.slice(0, 20)).toEqual(Array(20).fill(1));
    expect(counts.slice(20)).toEqual([0, 0]);

    // 200 participants fit; the 201st is refused.
    const full = createRoom({ now: () => clock });
    for (let i = 0; i < 200; i++) {
      full.connect(`c${i}`);
      full.handle(`c${i}`, join(`p${i}`));
    }
    full.connect("late");
    const refused = full.handle("late", join("late")).map((o) => o.envelope.body);
    expect(refused).toContainEqual({ type: "refused", of: "join", reason: "room full" });
    expect(full.snapshot().participants).toHaveLength(200);
  });
});

async function loadClientSide() {
  const room = await loadRoom();
  const client = await clientModules["./client.ts"]?.();
  const memory = await memoryModules["./core/transports/memory.ts"]?.();
  expect(client, "packages/session/src/client.ts exists").toBeDefined();
  return { ...room, ...client!, ...memory! };
}

/** A reader state API that records applies and lets the test move the reader. */
function fakeReader(url: string) {
  let current: ReaderSnapshot = { v: 1, url, nav: null, slices: {} };
  const applied: { url: string; origin: ApplyContext["origin"] }[] = [];
  const subs = new Set<(c: SnapshotChange, s: ReaderSnapshot) => void>();
  const api: ReaderStateApi = {
    getSnapshot: () => current,
    async applySnapshot(s, ctx) {
      applied.push({ url: s.url, origin: ctx.origin });
      current = { ...current, url: s.url };
      return { warnings: [] };
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    onLocalInput: () => () => undefined,
    applying: false,
  };
  return {
    api,
    applied,
    move(next: string) {
      current = { ...current, url: next };
      subs.forEach((cb) => cb({ url: next }, current));
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("spec 009: the client", () => {
  // @feature SESS-009 Room protocol and client in packages/session
  // @ac 009/AC-002
  it("follows the spotlight through applySnapshot with origin follow, and publishes nothing while canPublish says no", async () => {
    const { createRoom, createSessionClient, createMemoryPair } = await loadClientSide();
    const room = createRoom({ now: () => 0 });
    const ends = new Map<string, ReturnType<typeof createMemoryPair<AnyEnvelope>>[1]>();
    const sent: { conn: string; ch: string }[] = [];
    const connect = (conn: string, id: string, url: string, canPublish?: () => boolean) => {
      const [clientEnd, roomEnd] = createMemoryPair<AnyEnvelope>();
      ends.set(conn, roomEnd);
      room.connect(conn);
      roomEnd.onMessage((m) => {
        sent.push({ conn, ch: m.ch });
        for (const o of room.handle(conn, m)) for (const c of room.recipients(o.to)) ends.get(c)?.send(o.envelope);
      });
      const reader = fakeReader(url);
      const self = { id, isHost: true, canLead: true };
      return { reader, client: createSessionClient({ api: reader.api, transport: clientEnd, self, canPublish }) };
    };

    const leader = connect("c1", "leader", "/Genesis.1");
    await settle();
    const follower = connect("c2", "follower", "/Psalms.1");
    await settle();
    leader.reader.move("/Genesis.2");
    await settle();
    expect(follower.reader.applied.at(-1)).toEqual({ url: "/Genesis.2", origin: "follow" });

    // A spotlight holder whose canPublish says no sends nothing on the state channel but its hello.
    const quietRoom = { blocked: true };
    const quiet = connect("c3", "quiet", "/Exodus.1", () => !quietRoom.blocked);
    await settle();
    quiet.client.spotlight("quiet");
    await settle();
    expect(quiet.client.getState().room.spotlight).toBe("quiet");
    const statesBefore = sent.filter((m) => m.conn === "c3" && m.ch === "state").length;
    quiet.reader.move("/Exodus.2");
    await settle();
    expect(sent.filter((m) => m.conn === "c3" && m.ch === "state").length).toBe(statesBefore);
  });
});

describe("spec 009: the WebSocket transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // @feature SESS-009 Room protocol and client in packages/session
  // @ac 009/AC-003
  it("asks the protocols callback before every connection, so each socket carries a fresh token and the URL none", async () => {
    const mod = await wsModules["./core/transports/websocket.ts"]?.();
    expect(mod, "packages/session/src/core/transports/websocket.ts exists").toBeDefined();
    const opened: { url: string; protocols: unknown }[] = [];
    const sockets: { onclose: (() => void) | null; onopen: (() => void) | null }[] = [];
    class FakeSocket {
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor(url: string, protocols?: unknown) {
        opened.push({ url, protocols });
        sockets.push(this);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    let n = 0;
    const transport = mod!.createWebSocketTransport("wss://relay.test/r/room-0000001", {
      protocols: async () => ["sefaria-social.v1", `bearer.token-${++n}`],
      backoff: { initialMs: 1, maxMs: 1 },
    });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    transport.close();
    expect(opened).toEqual([
      { url: "wss://relay.test/r/room-0000001", protocols: ["sefaria-social.v1", "bearer.token-1"] },
      { url: "wss://relay.test/r/room-0000001", protocols: ["sefaria-social.v1", "bearer.token-2"] },
    ]);
  });
});
