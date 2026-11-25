// A recording's state track (spec 042): parsed with the session schema and the stream's order rules, and folded to the reader
// state at any media time. Modules load through import.meta.glob so that, on a base without them, the first assertion fails.
import { describe, expect, it } from "vitest";
import type * as TrackModule from "./state-track";
import type * as FixtureModule from "./test-track";

const mods = {
  track: import.meta.glob<typeof TrackModule>("./state-track.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
};

async function load() {
  const track = await mods.track["./state-track.ts"]?.();
  expect(track, "app/src/features/replay/state-track.ts exists").toBeDefined();
  const fixture = (await mods.fixture["./test-track.ts"]!())!;
  return { ...track!, ...fixture };
}

describe("state track", () => {
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-003
  it("gives the last keyframe at or before t with the later changes up to t folded in", async () => {
    const { parseStateTrack, snapshotAt, keyframeTimes, trackJson } = await load();
    const rec = parseStateTrack(trackJson());

    expect(keyframeTimes(rec)).toEqual([0, 10_000]);
    expect(snapshotAt(rec, 0)).toMatchObject({ key: "0:0", snapshot: { url: "/Genesis.1" } });
    expect(snapshotAt(rec, 3_999)).toMatchObject({ key: "0:0", snapshot: { url: "/Genesis.1" } });
    expect(snapshotAt(rec, 4_000)).toMatchObject({ key: "0:1", snapshot: { url: "/Genesis.2" } });
    expect(snapshotAt(rec, 7_000)).toMatchObject({
      key: "0:2",
      snapshot: { url: "/Genesis.2", slices: { "sefaria.scroll": { v: 1, value: { y: 300 } } } },
    });
    expect(snapshotAt(rec, 10_000)).toMatchObject({ key: "1:0", snapshot: { url: "/Genesis.2" } });
    expect(snapshotAt(rec, 19_000)).toMatchObject({ key: "1:1", snapshot: { url: "/Exodus.1" } });
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-003
  it("gives the first keyframe for a time before it", async () => {
    const { parseStateTrack, snapshotAt, trackJson } = await load();
    const json = trackJson();
    const messages = json.messages as { t: number }[];
    for (const m of messages) m.t += 500;
    const rec = parseStateTrack(json);
    expect(snapshotAt(rec, 0)).toMatchObject({ key: "0:0", snapshot: { url: "/Genesis.1" } });
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-008
  it("refuses a track that fails the schema or the stream's order", async () => {
    const { parseStateTrack, InvalidRecordingError, trackJson } = await load();
    const bad = (mutate: (json: Record<string, unknown>, messages: Record<string, unknown>[]) => void) => {
      const json = trackJson();
      mutate(json, json.messages as Record<string, unknown>[]);
      return () => parseStateTrack(json);
    };

    expect(bad((j) => (j.v = 2))).toThrow(InvalidRecordingError);
    expect(bad((_j, m) => (m[1]!.t = "soon"))).toThrow(InvalidRecordingError);
    expect(bad((_j, m) => m.shift())).toThrow(/first message is not a keyframe/);
    expect(bad((_j, m) => (m[2]!.seq = 7))).toThrow(/seq 7 does not follow 1/);
    expect(bad((_j, m) => (m[2]!.t = 3_000))).toThrow(/t goes back at seq 2/);
    expect(bad((j) => (j.messages = []))).toThrow(/first message is not a keyframe/);
    expect(() => parseStateTrack("not json")).toThrow(InvalidRecordingError);
  });
});
