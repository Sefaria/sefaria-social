// The replay player (spec 042) with a fake media element as the clock and a fake reader state API. Modules load through
// import.meta.glob so that, on a base without them, the first assertion fails.
import { describe, expect, it } from "vitest";
import type * as PlayerModule from "./player";
import type * as TrackModule from "./state-track";
import type * as FixtureModule from "./test-track";

const mods = {
  player: import.meta.glob<typeof PlayerModule>("./player.ts"),
  track: import.meta.glob<typeof TrackModule>("./state-track.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
};

const PLAYBACK = { origin: "playback", persist: false };

async function setup(opts: { manual?: boolean } = {}) {
  const playerMod = await mods.player["./player.ts"]?.();
  expect(playerMod, "app/src/features/replay/player.ts exists").toBeDefined();
  const { parseStateTrack } = (await mods.track["./state-track.ts"]!())!;
  const { createFakeMedia, createFakeState, trackJson, flush } = (await mods.fixture["./test-track.ts"]!())!;
  const media = createFakeMedia();
  const state = createFakeState(opts);
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const player = playerMod!.createReplayPlayer({
    media,
    track: parseStateTrack(trackJson()),
    state: state as unknown as PlayerModule.ReplayPlayerDeps["state"],
    setInterval: (cb) => {
      timers.set(nextTimer, cb);
      return nextTimer++;
    },
    clearInterval: (h) => void timers.delete(h as number),
  });
  await flush();
  const tick = async () => {
    for (const cb of timers.values()) cb();
    await flush();
  };
  return { player, media, state, timers, tick, flush };
}

describe("replay player", () => {
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-003
  it("plays across a change at 4 s and applies Genesis 2 with origin playback, not persisted", async () => {
    const { player, media, state, tick, flush } = await setup();
    expect(state.applied, "the reader starts at the recording's start").toEqual([
      { snapshot: expect.objectContaining({ url: "/Genesis.1" }), ctx: PLAYBACK },
    ]);

    await player.play();
    expect(player.view()).toMatchObject({
      playing: true,
      t: 0,
      duration: 20_000,
      rate: 1,
      following: true,
      keyframes: [0, 10_000],
    });
    media.advance(3);
    await flush();
    await tick();
    expect(state.urls(), "nothing new before 4 s").toEqual(["/Genesis.1"]);

    media.advance(1.5);
    await flush();
    expect(state.applied.at(-1)).toEqual({ snapshot: expect.objectContaining({ url: "/Genesis.2" }), ctx: PLAYBACK });
    await tick();
    expect(state.urls(), "the same point is applied once").toEqual(["/Genesis.1", "/Genesis.2"]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-003
  it("ticks every 250 ms while playing and stops ticking when paused", async () => {
    const { player, media, state, timers, tick } = await setup();
    expect(timers.size).toBe(0);
    await player.play();
    expect(timers.size).toBe(1);
    media.drift(5);
    expect(state.urls(), "no event, nothing yet").toEqual(["/Genesis.1"]);
    await tick();
    expect(state.urls(), "the tick applies the change").toEqual(["/Genesis.1", "/Genesis.2"]);

    player.pause();
    expect(timers.size).toBe(0);
    expect(player.view().playing).toBe(false);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-004
  it("pause, seek, skip and speed act on the media and the reader together", async () => {
    const { player, media, state, flush } = await setup();
    await player.play();
    media.advance(2);
    player.pause();
    expect(media.paused).toBe(true);
    expect(player.view().playing).toBe(false);
    media.advance(5);
    await flush();
    expect(state.urls(), "paused: neither moves").toEqual(["/Genesis.1"]);

    player.seek(12_500);
    await flush();
    expect(media.currentTime).toBe(12.5);
    expect(state.urls().at(-1)).toBe("/Exodus.1");
    expect(player.view().t).toBe(12_500);

    player.skip(-10_000);
    await flush();
    expect(media.currentTime).toBe(2.5);
    expect(state.urls().at(-1)).toBe("/Genesis.1");

    player.skip(10_000);
    await flush();
    expect(media.currentTime).toBe(12.5);
    expect(state.urls().at(-1)).toBe("/Exodus.1");

    player.seek(-5_000);
    await flush();
    expect(media.currentTime).toBe(0);
    player.seek(99_000);
    await flush();
    expect(media.currentTime).toBe(20);

    player.seek(0);
    player.setRate(2);
    expect(media.playbackRate).toBe(2);
    expect(player.view().rate).toBe(2);
    await player.play();
    media.advance(2.5); // 5 s of media at 2×
    await flush();
    expect(media.currentTime).toBe(5);
    expect(state.urls().at(-1)).toBe("/Genesis.2");
    player.setRate(1.5);
    expect(player.view().rate).toBe(1.5);
    expect(state.applied.every((a) => a.ctx.origin === "playback" && a.ctx.persist === false)).toBe(true);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-005
  it("local input detaches the reader while the media keeps playing; rejoin applies the current point", async () => {
    const { player, media, state, tick, flush } = await setup();
    await player.play();
    state.input();
    expect(player.view()).toMatchObject({ following: false, playing: true });

    media.advance(5);
    await tick();
    expect(state.urls(), "detached: the reader is left alone").toEqual(["/Genesis.1"]);
    expect(media.paused).toBe(false);
    expect(media.currentTime).toBe(5);

    player.rejoin();
    await flush();
    expect(player.view().following).toBe(true);
    expect(state.applied.at(-1)).toEqual({ snapshot: expect.objectContaining({ url: "/Genesis.2" }), ctx: PLAYBACK });

    // Rejoining at the same point re-applies it: the reader may have moved away from it.
    state.input();
    player.rejoin();
    await flush();
    expect(state.urls()).toEqual(["/Genesis.1", "/Genesis.2", "/Genesis.2"]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-005
  it("ignores the reader's input events caused by its own apply", async () => {
    const { player, state } = await setup({ manual: true });
    expect(state.applying).toBe(true);
    state.input();
    expect(player.view().following).toBe(true);
    await state.settle();
    expect(state.applying).toBe(false);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-003
  it("applies one state at a time; requests meanwhile collapse to the latest", async () => {
    const { player, media, state, flush } = await setup({ manual: true });
    expect(state.inFlight()).toBe(1);
    await player.play();
    player.seek(5_000);
    player.seek(7_000);
    player.seek(13_000);
    await flush();
    expect(state.inFlight(), "still one apply in flight").toBe(1);
    expect(state.urls()).toEqual(["/Genesis.1"]);

    await state.settle();
    expect(state.urls(), "only the latest pending point").toEqual(["/Genesis.1", "/Exodus.1"]);
    expect(state.inFlight()).toBe(1);
    await state.settle();
    expect(state.inFlight()).toBe(0);
    media.advance(1);
    await flush();
    expect(state.urls(), "the same point is not applied again").toEqual(["/Genesis.1", "/Exodus.1"]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  it("dispose removes every listener and timer", async () => {
    const { player, media, timers, state } = await setup();
    await player.play();
    expect(media.listenerCount()).toBe(6);
    player.dispose();
    expect(media.listenerCount()).toBe(0);
    expect(timers.size).toBe(0);
    const count = state.applied.length;
    state.input();
    media.advance(10);
    expect(state.applied.length).toBe(count);
  });
});
