// The call controller (spec 034) against the fake media engine, the fake host, a fake rooms API and fake room sessions. The
// controller module loads through import.meta.glob so that, on a base without it, the first assertion fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./call-controller";
import type * as MediaModule from "./test-media";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("./test-media.ts"),
};

const R = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const S = "7a2b3c4d-5e6f-4a7b-8c9d-001122334466";

function fakeSessions() {
  const holds: { roomId: string; hold: string; released: boolean }[] = [];
  return {
    holds,
    acquire: (roomId: string, hold: string) => {
      const h = { roomId, hold, released: false };
      holds.push(h);
      return () => void (h.released = true);
    },
    held: (roomId: string) => holds.filter((h) => h.roomId === roomId && h.hold === "call" && !h.released).length,
  };
}

function fakeRooms() {
  const listeners = new Set<(roomId: string) => void>();
  const order: string[] = [];
  return {
    order,
    onLeave(cb: (roomId: string) => void) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    /** The room controller's leave: listeners first, then its own release. */
    leave(roomId: string) {
      for (const cb of listeners) cb(roomId);
      order.push(`room-left:${roomId}`);
    },
  };
}

async function setup(opts: { tokenFails?: number } = {}) {
  const controllerMod = await mods.controller["./call-controller.ts"]?.();
  expect(controllerMod, "app/src/features/av/call-controller.ts exists").toBeDefined();
  const { createFakeEngine } = (await mods.media["./test-media.ts"]!())!;
  const engine = createFakeEngine();
  const loadEngine = vi.fn(async () => engine);
  const fake = createFakeHost({ url: `/Genesis.1?ctx=social.room.${R}`, viewer: { id: 4242, name: "Test Learner" } });
  let tokenFails = opts.tokenFails ?? 0;
  const api = {
    getRoom: vi.fn(),
    join: vi.fn(),
    getCallToken: vi.fn(async (roomId: string) => {
      if (tokenFails > 0) {
        tokenFails--;
        throw new TypeError("network down");
      }
      return { kind: "ok" as const, url: "wss://livekit.test", token: `token-for-${roomId}`, expiresAt: "2026-11-24T00:10:00Z" };
    }),
  };
  const sessions = fakeSessions();
  const rooms = fakeRooms();
  const calls = controllerMod!.createCallController({ host: fake.host, api, loadEngine, sessions, rooms });
  const join = async (roomId: string, devices = { mic: true, camera: false }) => {
    await calls.open(roomId);
    calls.choose({ ...calls.devices(), ...devices });
    await calls.join();
  };
  return { calls, engine, loadEngine, fake, api, sessions, rooms, join };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("call controller", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-007
  it("leaving the call disconnects and stops every track but keeps the room; leaving the room ends the call first", async () => {
    const { calls, engine, sessions, rooms, join } = await setup();
    await join(R, { mic: true, camera: true });
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: R, mic: true, camera: true });
    expect(sessions.held(R), "the call holds the room's session").toBe(1);
    const first = engine.last();

    await calls.leave();
    expect(first.disconnected).toBe(true);
    expect(first.participants().find((p) => p.local)).toMatchObject({ mic: false, camera: false, screen: false });
    expect(calls.view()).toEqual({ kind: "off" });
    expect(sessions.held(R), "the call's hold is released").toBe(0);
    expect(rooms.order, "the room is not left").toEqual([]);

    await join(R);
    const second = engine.last();
    const order: string[] = [];
    const disconnect = second.disconnect.bind(second);
    second.disconnect = async () => {
      order.push("call-left");
      await disconnect();
    };
    rooms.leave(R);
    order.push(...rooms.order);
    expect(order).toEqual(["call-left", `room-left:${R}`]);
    expect(calls.view()).toEqual({ kind: "off" });
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-008
  it("asks before switching to another room's call, and leaves the first call before joining the second", async () => {
    const { calls, engine, join } = await setup();
    await join(R);
    const first = engine.last();

    await calls.open(S);
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: R, switchTo: S });
    expect(first.disconnected, "nothing changes before the viewer confirms").toBe(false);

    calls.cancelSwitch();
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: R, switchTo: null });

    await calls.open(S);
    await calls.confirmSwitch();
    expect(first.disconnected).toBe(true);
    expect(calls.view()).toMatchObject({ kind: "prejoin", roomId: S, devices: { mic: false, camera: false } });
    calls.choose({ ...calls.devices(), mic: true });
    await calls.join();
    expect(engine.calls.connects.map((c) => c.token)).toEqual([`token-for-${R}`, `token-for-${S}`]);
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: S });
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-011
  it("reconnects with a fresh token when the connection drops, and gives up after 30 seconds with Rejoin", async () => {
    const { calls, engine, api, join } = await setup();
    await join(R);
    expect(api.getCallToken).toHaveBeenCalledTimes(1);

    // LiveKit's own short reconnect: shown, then back
    engine.last().drop("reconnecting");
    expect(calls.view()).toMatchObject({ kind: "reconnecting", roomId: R });
    engine.last().drop("connected");
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: R });

    // the connection is gone: a fresh token and a new connection
    engine.last().drop("disconnected", "other");
    expect(calls.view()).toMatchObject({ kind: "reconnecting", roomId: R });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.getCallToken).toHaveBeenCalledTimes(2);
    expect(engine.connections).toHaveLength(2);
    expect(calls.view()).toMatchObject({ kind: "in-call", roomId: R });

    // gone again, and the network stays down: Rejoin after 30 s
    engine.failNextConnects(1_000);
    engine.last().drop("disconnected", "other");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.view()).toMatchObject({ kind: "reconnecting" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls.view()).toEqual({ kind: "ended", roomId: R, reason: "error" });
    const attempts = engine.calls.connects.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.calls.connects.length, "no more attempts after giving up").toBe(attempts);

    // Rejoin opens the pre-join step again, everything off
    await calls.open(R);
    expect(calls.view()).toMatchObject({ kind: "prejoin", roomId: R, devices: { mic: false, camera: false } });
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-011
  it("does not reconnect after the viewer left, or after the owner removed them", async () => {
    const { calls, engine, join } = await setup();
    await join(R);
    engine.last().drop("disconnected", "removed");
    expect(calls.view()).toEqual({ kind: "ended", roomId: R, reason: "removed" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.connections).toHaveLength(1);
  });

  // @feature SESS-057 Call state machine and controller
  // @ac 034/AC-012
  it("reports join, reconnect, error and leave with counts and durations only", async () => {
    const { calls, engine, fake, join } = await setup();
    await join(R);
    engine.last().setRemote([
      { id: "u:5151", name: "Avi Owner", mic: true, camera: true, screen: false, speaking: true },
      { id: "u:6161", name: "רבקה", mic: false, camera: false, screen: false, speaking: false },
    ]);
    engine.last().drop("disconnected", "other");
    await vi.advanceTimersByTimeAsync(1_000);
    engine.failNextConnects(1);
    await calls.leave();
    await calls.open(R);
    calls.choose({ ...calls.devices(), mic: true });
    await calls.join(); // fails once: ended with error
    await vi.advanceTimersByTimeAsync(60_000);

    const av = fake.calls.report.filter((r) => r.name.startsWith("av."));
    expect(av.map((r) => r.name)).toEqual(expect.arrayContaining(["av.join", "av.reconnect", "av.leave", "av.error"]));
    const leave = av.find((r) => r.name === "av.leave")!;
    expect(leave.data).toMatchObject({ peakParticipants: 3 });
    expect(typeof leave.data?.durationS).toBe("number");
    expect(av.find((r) => r.name === "av.error")?.data).toMatchObject({ kind: expect.any(String) });
    const text = JSON.stringify(av);
    for (const personal of ["Avi", "רבקה", "Test Learner", "u:5151", "u:4242", "4242", "Built-in", "mic-1", "token-for"])
      expect(text.includes(personal), `reports contain ${personal}`).toBe(false);
  });
});
