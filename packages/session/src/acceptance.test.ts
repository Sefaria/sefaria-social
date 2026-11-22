// Acceptance tests for spec 009 (room protocol and client). The modules are loaded through import.meta.glob so that, on a
// base without packages/session, the first assertion fails (prove-red) instead of the import.
import { describe, expect, it } from "vitest";
import type * as RoomModule from "./room";

const roomModules = import.meta.glob<typeof RoomModule>("./room.ts");

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
