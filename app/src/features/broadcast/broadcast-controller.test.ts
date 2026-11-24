// @vitest-environment jsdom
// The broadcast controller (spec 043) against the fake host (the reader), the test relay (the relay's rooms, behind a fake
// WebSocket), real room sessions, a fake broadcast API and a fake call controller. The module loads through import.meta.glob so
// that, on a base without it, the first assertion fails.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./broadcast-controller";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SessionsModule from "~/features/session/sessions";
import type { CallSource } from "~/features/av/call-controller";
import type { CallView } from "~/features/av/machine";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./broadcast-controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("../session/test-relay.ts"),
  sessions: import.meta.glob<typeof SessionsModule>("../session/sessions.ts"),
};

const ROOM = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const BID = "0b1c2d3e-4f5a-4b6c-8d7e-00112233aabb";
const RELAY_ROOM = `b_${BID}`;
const WATCH = `ctx=social.watch.${BID}`;
const SELF = { id: 4242, name: "Test Learner" };

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
});

function fakeApi(role: "host" | "viewer") {
  const state = { status: "live" as "live" | "ended", tickets: 0, ttlMs: 600_000 };
  const broadcast = () => ({
    id: BID,
    roomId: ROOM,
    title: "Daf Yomi live",
    hostName: "Avi Host",
    status: state.status,
    startedAt: "2026-11-25T08:00:00.000Z",
    link: `/social/b/${BID}`,
  });
  return {
    state,
    start: vi.fn(async (_roomId: string) => ({ kind: "ok" as const, broadcast: broadcast() })),
    end: vi.fn(async (_id: string) => {
      state.status = "ended";
    }),
    get: vi.fn(async (_id: string) => ({ kind: "ok" as const, broadcast: broadcast() })),
    ticket: vi.fn(async (_id: string) => {
      if (state.status === "ended") return { kind: "ended" as const };
      state.tickets++;
      return {
        kind: "ok" as const,
        ticket: {
          ticket: `tkt-${state.tickets}`,
          role,
          relayRoom: RELAY_ROOM,
          expiresAt: new Date(Date.now() + state.ttlMs).toISOString(),
        },
      };
    }),
    callToken: vi.fn(async (_id: string) => ({
      kind: "ok" as const,
      url: "wss://livekit.test",
      token: "bcast-token",
      expiresAt: "2026-11-25T08:10:00Z",
    })),
  };
}

function fakeCalls() {
  let view: CallView = { kind: "off" };
  const joined: { key: string; source: CallSource }[] = [];
  const opened: { key: string; source?: CallSource }[] = [];
  return {
    joined,
    opened,
    view: () => view,
    joinWith: vi.fn(async (key: string, source: CallSource) => {
      joined.push({ key, source });
      view = { kind: "in-call", roomId: key, mic: false, camera: false, screen: false, switchTo: null };
    }),
    open: vi.fn(async (key: string, source?: CallSource) => {
      opened.push({ key, ...(source ? { source } : {}) });
      view = {
        kind: "prejoin",
        roomId: key,
        devices: { mic: false, camera: false, audioDeviceId: null, videoDeviceId: null, permission: "unknown" },
      };
    }),
    leave: vi.fn(async () => {
      view = { kind: "off" };
    }),
    dismiss: vi.fn(() => {
      view = { kind: "off" };
    }),
  };
}

type Peer = ReturnType<ReturnType<typeof RelayModule.installTestRelay>["peer"]>;
function streamOf(peer: Peer) {
  let seq = 0;
  return (path: string) =>
    peer.send({
      ch: "state",
      body:
        seq === 0
          ? { type: "keyframe", seq: seq++, t: 0, snapshot: { v: 1, url: path, nav: null, slices: {} } }
          : { type: "change", seq: seq++, t: seq, change: { url: path } },
    });
}

async function setup(url: string, role: "host" | "viewer", opts: { now?: () => number } = {}) {
  const controllerMod = await mods.controller["./broadcast-controller.ts"]?.();
  expect(controllerMod, "app/src/features/broadcast/broadcast-controller.ts exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["../session/test-relay.ts"]!())!;
  const { createRoomSessions } = (await mods.sessions["../session/sessions.ts"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const fake = createFakeHost({ url, viewer: SELF });
  const api = fakeApi(role);
  const calls = fakeCalls();
  const sessions = createRoomSessions(fake.host);
  const owner = { request: vi.fn(async (_o: "call") => true) };
  const controller = controllerMod!.createBroadcastController({
    host: fake.host,
    api,
    sessions,
    calls,
    windowOwner: owner,
    ...(opts.now ? { now: opts.now } : {}),
  });
  teardown.push(() => controller.dispose());
  const opened = () => relay.opened.filter((o) => o.url.endsWith(`/r/${RELAY_ROOM}`));
  return { relay, fake, api, calls, sessions, owner, controller, opened };
}

/** A viewer who pressed Watch while the host is on Genesis 3. */
async function watching() {
  const s = await setup("/social/b/" + BID, "viewer");
  const hostPeer = s.relay.peer(RELAY_ROOM, "5151", "Avi Host");
  const hostMoves = streamOf(hostPeer);
  hostMoves("/Genesis.3");
  await s.controller.watch(BID);
  return { ...s, hostPeer, hostMoves };
}

describe("broadcast controller", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("connects a viewer with the ticket subprotocol and canPublish false, lands on the host's text with the watch ctx, and follows", async () => {
    const { fake, opened, relay, hostPeer, hostMoves, controller, calls, api, owner } = await watching();
    expect(opened().map((o) => o.protocols.filter((p) => !p.startsWith("bearer.")))).toEqual([
      ["sefaria-social.v1", "ticket.tkt-1"],
    ]);
    expect(opened()[0]!.protocols.some((p) => p.startsWith("bearer."))).toBe(true);
    expect(fake.calls.navigate.map((n) => n.to)).toEqual([`/Genesis.3?${WATCH}`]);
    expect(controller.watchView()).toEqual({ kind: "watching", id: BID, following: true, hostName: "Avi Host" });
    // The viewer joined as a viewer: never a host, never a leader.
    const self = relay
      .room(RELAY_ROOM)
      .snapshot()
      .participants.find((p) => p.id === "4242");
    expect(self && { isHost: self.isHost, canLead: self.canLead }).toEqual({ isHost: false, canLead: false });

    hostMoves("/Genesis.4");
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.4?${WATCH}`));
    expect(fake.calls.applied.every((a) => a.ctx.origin === "follow")).toBe(true);

    // Nothing the viewer does is published: canPublish is false.
    fake.localMove("/Exodus.1");
    await new Promise((r) => setTimeout(r, 30));
    const fromViewer = hostPeer.received.filter(
      (m) => (m as { ch: string; from?: string }).ch === "state" && (m as { from?: string }).from === "4242",
    );
    expect(fromViewer).toEqual([]);

    // The call: asked for the window first, then joined view only with the broadcast's token.
    expect(owner.request).toHaveBeenCalledWith("call");
    await vi.waitFor(() => expect(calls.joined.map((j) => [j.key, j.source.viewer])).toEqual([[`bcast_${BID}`, true]]));
    await calls.joined[0]!.source.tokenSource();
    expect(api.callToken).toHaveBeenCalledWith(BID);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("breaks away on local input and catches up on Back to live", async () => {
    const { fake, hostMoves, controller } = await watching();
    fake.localInput();
    await vi.waitFor(() => expect(controller.watchView()).toMatchObject({ kind: "watching", following: false }));
    const applied = fake.calls.applied.length;
    hostMoves("/Genesis.9");
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.calls.applied.length).toBe(applied);
    controller.backToLive();
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.9?${WATCH}`));
    expect(controller.watchView()).toMatchObject({ kind: "watching", following: true });
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-008
  it("ends watching when the room ends: no more following, and the call is left", async () => {
    const { fake, hostPeer, controller, calls, relay } = await watching();
    await vi.waitFor(() => expect(calls.view().kind).toBe("in-call"));
    hostPeer.send({ ch: "control", body: { type: "end" } });
    await vi.waitFor(() => expect(controller.watchView()).toEqual({ kind: "ended", id: BID }));
    expect(calls.leave).toHaveBeenCalledTimes(1);
    expect(calls.view().kind).toBe("off");
    await vi.waitFor(() => expect(relay.open(RELAY_ROOM)).toBe(0));
    expect(fake.url()).toBe(`/Genesis.3?${WATCH}`); // the reader stays where it is
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-008
  it("says ended for a broadcast the server reports ended, without opening a socket or a call", async () => {
    const { api, controller, opened, calls, fake } = await setup("/social/b/" + BID, "viewer");
    api.state.status = "ended";
    await controller.watch(BID);
    expect(controller.watchView()).toEqual({ kind: "ended", id: BID });
    expect(opened()).toEqual([]);
    expect(calls.joinWith).not.toHaveBeenCalled();
    expect(fake.calls.navigate).toEqual([]);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("rejoins as a viewer from a cold load with the watch ctx, without navigating", async () => {
    const controllerMod = await mods.controller["./broadcast-controller.ts"]?.();
    expect(controllerMod, "app/src/features/broadcast/broadcast-controller.ts exists").toBeDefined();
    const s = await setup(`/Genesis.5?${WATCH}`, "viewer");
    await vi.waitFor(() => expect(s.controller.watchView()).toMatchObject({ kind: "watching", id: BID }));
    expect(s.opened()).toHaveLength(1);
    expect(s.fake.calls.navigate).toEqual([]);
    await vi.waitFor(() => expect(s.calls.joinWith).toHaveBeenCalledTimes(1));
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("asks for a fresh ticket when a reconnect comes after the held one has nearly expired", async () => {
    let clock = Date.now();
    const s = await setup("/social/b/" + BID, "viewer", { now: () => clock });
    s.relay.peer(RELAY_ROOM, "5151", "Avi Host");
    await s.controller.watch(BID);
    await vi.waitFor(() => expect(s.relay.open(RELAY_ROOM)).toBe(1));
    clock += 9.5 * 60_000; // inside the margin before the 10-minute expiry
    s.relay.drop(RELAY_ROOM);
    await vi.waitFor(() => expect(s.opened()).toHaveLength(2), { timeout: 3_000 });
    expect(s.opened()[1]!.protocols).toContain("ticket.tkt-2");
    expect(s.api.ticket).toHaveBeenCalledTimes(2);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-006
  it("starts a broadcast for the host: holds the spotlight, publishes the reader from a reader page, counts viewers, and ends it", async () => {
    const { fake, api, calls, controller, opened, relay } = await setup(`/social/r/${ROOM}`, "host");
    await controller.start(ROOM);
    expect(api.start).toHaveBeenCalledWith(ROOM);
    expect(controller.hostView()).toMatchObject({ kind: "live", id: BID, roomId: ROOM, link: `/social/b/${BID}` });
    await vi.waitFor(() => expect(opened()[0]?.protocols).toContain("ticket.tkt-1"));
    await vi.waitFor(() => expect(relay.room(RELAY_ROOM).snapshot().spotlight).toBe("4242"));

    const viewer = relay.peer(RELAY_ROOM, "7070", "A Viewer");
    await vi.waitFor(() => expect(controller.hostView()).toMatchObject({ kind: "live", viewers: 1 }));
    fake.localMove("/Exodus.2");
    const fromHost = () =>
      viewer.received.filter(
        (m) => (m as { ch: string; from?: string }).ch === "state" && (m as { from?: string }).from === "4242",
      );
    await vi.waitFor(() => expect(JSON.stringify(fromHost())).toContain("/Exodus.2"));
    expect(JSON.stringify(fromHost())).not.toContain("ctx");

    await controller.joinCall();
    expect(calls.opened.map((o) => [o.key, o.source?.viewer ?? false])).toEqual([[`bcast_${BID}`, false]]);

    await controller.end();
    expect(api.end).toHaveBeenCalledWith(BID);
    expect(relay.room(RELAY_ROOM).snapshot().ended).toBe(true);
    expect(calls.leave).toHaveBeenCalledTimes(1);
    expect(controller.hostView()).toEqual({ kind: "idle" });
    await vi.waitFor(() => expect(relay.open(RELAY_ROOM)).toBe(0));
  });
});
