// @vitest-environment jsdom
// Spec 053: a shiur's player. The replay window rendered with the fake host, a fake recordings API with the real API's methods
// (a manifest with chapters, a timeline with the talking head's place) and a fake media element that is its own clock; and the
// real API module against a fake fetch for signed-out playback. Modules load through import.meta.glob so that, on a base
// without them, the first assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as WindowModule from "./ReplayWindow";
import type * as ControllerModule from "./replay-controller";
import type * as FixtureModule from "./test-track";
import type * as ApiModule from "./replay-api";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";

const mods = {
  window: import.meta.glob<typeof WindowModule>("./ReplayWindow.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("./replay-controller.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
  api: import.meta.glob<typeof ApiModule>("./replay-api.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
};

const REC = "9b1c2d3e-4b5a-4c6d-8e7f-0011223344aa";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

const head = (x: number, y: number) => ({ x, y, w: 0.25, h: 0.2 });
const slices = (camera: boolean, place: ReturnType<typeof head> | null, ref: string) => ({
  "social.overlay": { v: 1, value: { camera, head: place } },
  "social.summary": { v: 1, value: { ref, heRef: null, title: ref } },
});
/** 20 s: Genesis 1 with the head at the bottom right; at 8 s Exodus 3 and the head moves to the top left; at 14 s the camera off. */
const track = () => ({
  v: 1,
  startedAt: "2026-11-01T10:00:00.000Z",
  duration: 20_000,
  messages: [
    {
      type: "keyframe",
      seq: 0,
      t: 0,
      snapshot: { v: 1, url: "/Genesis.1", nav: null, slices: slices(true, head(0.7, 0.7), "Genesis 1") },
    },
    { type: "change", seq: 1, t: 8_000, change: { url: "/Exodus.3", slices: slices(true, head(0.05, 0.1), "Exodus 3") } },
    {
      type: "change",
      seq: 2,
      t: 14_000,
      change: { slices: { "social.overlay": { v: 1, value: { camera: false, head: head(0.05, 0.1) } } } },
    },
  ],
});
/** Spec 054: what the leader said, with times (ms): a first line at 0–3 s, a second from 8 s. */
const words = [
  { w: "Bereshit", s: 0, e: 800 },
  { w: "bara", s: 900, e: 1500 },
  { w: "Elokim", s: 1600, e: 2400 },
  { w: "Vayomer", s: 8000, e: 8600 },
  { w: "Hashem", s: 8700, e: 9300 },
];
const chapters = [
  { t: 0, ref: "Genesis 1", heRef: "בראשית א׳" },
  { t: 8_000, ref: "Exodus 3", heRef: "שמות ג׳" },
];

async function setup(opts: { hasVideo?: boolean; lang?: "english" | "hebrew"; transcript?: boolean } = {}) {
  const windowMod = await mods.window["./ReplayWindow.tsx"]?.();
  expect(windowMod, "app/src/features/replay/ReplayWindow.tsx exists").toBeDefined();
  const { replayControllerFor } = (await mods.controller["./replay-controller.ts"]!())!;
  const { createFakeMedia, flush } = (await mods.fixture["./test-track.ts"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const fake = createFakeHost({
    url: `/Genesis.1?ctx=social.rec.${REC}`,
    viewer: { id: 4242, name: "Test Learner" },
    ui: { interfaceLang: opts.lang ?? "english" },
  });
  const api = {
    listRecordings: vi.fn(async () => []),
    deleteRecording: vi.fn(async () => undefined),
    getRecording: vi.fn(async () => ({ id: REC, durationMs: 20_000 })),
    getState: vi.fn(async () => track()),
    getManifest: vi.fn(async () => ({ durationMs: 20_000, hasVideo: opts.hasVideo ?? true, chapters })),
    getMedia: vi.fn(async () => new Blob([new Uint8Array(10)])),
    getTranscript: vi.fn(async () => (opts.transcript ? { words } : null)),
  } as ApiModule.ReplayApi;
  const media = createFakeMedia();
  const replay = replayControllerFor(fake.host, {
    api,
    createMedia: () => media,
    objectUrls: { create: () => "blob:replay", revoke: () => undefined },
  });
  const view = await render(createElement(HostContext.Provider, { value: fake.host }, createElement(windowMod!.ReplayWindow)));
  teardown.push(view.unmount);
  teardown.push(() => replay.close());
  await act(async () => replay.open(REC));
  await act(flush);
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const press = async (sel: string) => {
    const el = q(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
    await act(flush);
  };
  const at = async (seconds: number) => {
    await act(async () => replay.player()!.seek(seconds * 1000));
    await act(flush);
  };
  const key = async (sel: string, k: string) => {
    await act(async () => q(sel)!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
    await act(flush);
  };
  return { replay, media, q, press, at, key };
}

describe("the transcript in the player (spec 054)", () => {
  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-006
  it("shows the line being said under the bar, the word being said marked, and hides it on Transcript", async () => {
    const { q, at, press } = await setup({ transcript: true });
    const line = () => q("[data-transcript-line]")?.textContent?.trim() ?? null;
    expect(line(), "the transcript line").toBe("Bereshit bara Elokim");
    await at(1);
    expect(q("[data-transcript-line] [data-spoken]")?.textContent?.trim()).toBe("bara");
    await at(8.8);
    expect(line()).toBe("Vayomer Hashem");
    expect(q("[data-action=replay-transcript]")?.getAttribute("aria-pressed")).toBe("true");
    await press("[data-action=replay-transcript]");
    expect(q("[data-transcript-line]")).toBeNull();
  });

  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  it("offers no Transcript when the shiur has none", async () => {
    const { q } = await setup();
    expect(q("[data-replay-bar]")).not.toBeNull();
    expect(q("[data-action=replay-transcript]")).toBeNull();
  });
});

describe("a shiur's player (spec 053)", () => {
  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-001
  it("docks a bar at the bottom with play, the seek bar, a marker per chapter, speed, hide video and Close", async () => {
    const { q } = await setup();
    const bar = q("[data-replay-bar]");
    expect(bar, "the player bar").not.toBeNull();
    expect(bar!.getAttribute("role")).toBe("region");
    for (const sel of ["replay-play", "replay-scrub", "replay-hide-video", "replay-close"])
      expect(bar!.querySelector(`[data-action=${sel}]`), sel).not.toBeNull();
    expect([...bar!.querySelectorAll("[data-chapter]")].map((m) => m.getAttribute("data-chapter"))).toEqual(["0", "8000"]);
    expect(bar!.querySelectorAll("[data-rate]")).toHaveLength(3);
    expect(q("[data-call-window] [data-replay-transport]"), "the transport left the window").toBeNull();
  });

  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-002
  it("names each chapter's ref, goes there on a click, and says which chapter is playing", async () => {
    const { q, press, media } = await setup();
    const marker = q('[data-chapter="8000"]');
    expect(marker?.getAttribute("aria-label")).toBe("Go to Exodus 3 (0:08)");
    expect(marker?.textContent).toBe("Exodus 3");
    expect(q("[data-replay-chapter]")?.textContent).toBe("Genesis 1");
    await press('[data-chapter="8000"]');
    expect(media.currentTime).toBe(8);
    expect(q("[data-replay-chapter]")?.textContent).toBe("Exodus 3");
    expect(q("[data-action=replay-scrub]")?.getAttribute("aria-valuetext")).toBe("0:08 / 0:20 · Exodus 3");
  });

  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-003
  it("puts the talking head where the leader had it, moves it with them, and hides it with the camera or Hide video", async () => {
    const { q, at, press } = await setup();
    // The window shown (a hidden one stays in the page, so the video keeps playing: a media element taken out pauses).
    const box = () => {
      const w = q<HTMLElement>('[data-replay-frame="shown"] [data-call-window]');
      return w ? { left: w.style.left, top: w.style.top } : null;
    };
    const px = (f: number, size: number) => `${Math.round(f * size)}px`;
    expect(box()).toEqual({ left: px(0.7, window.innerWidth), top: px(0.7, window.innerHeight) });
    await at(9);
    expect(box()).toEqual({ left: px(0.05, window.innerWidth), top: px(0.1, window.innerHeight) });
    await at(15);
    expect(box(), "the camera was off").toBeNull();
    expect(q('[data-replay-frame="hidden"] [data-replay-media]'), "the media stays in the page, playing").not.toBeNull();
    await at(2);
    await press("[data-action=replay-hide-video]");
    expect(box(), "hidden").toBeNull();
    await press("[data-action=replay-show-video]");
    expect(box()).not.toBeNull();
  });

  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-003
  it("shows no talking head and no Hide video for an audio-only shiur", async () => {
    const { q } = await setup({ hasVideo: false });
    expect(q("[data-replay-bar]")).not.toBeNull();
    expect(q('[data-replay-frame="shown"] [data-call-window]')).toBeNull();
    expect(q("[data-action=replay-hide-video]")).toBeNull();
  });

  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-004
  it("plays a ready shiur for someone signed out through the public reads", async () => {
    const { createReplayApi } = (await mods.api["./replay-api.ts"]!())!;
    const fake = createFakeHost({ url: "/texts", viewer: null });
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      urls.push(u);
      if (u.endsWith(`/assets/${REC}`))
        return new Response(JSON.stringify({ id: REC, title: "Shiur", durationMs: 20_000, leader: { name: "Rav" } }));
      if (u.endsWith(`/assets/${REC}/state`)) return new Response(JSON.stringify(track()));
      if (u.endsWith(`/assets/${REC}/manifest`)) return new Response(JSON.stringify({ hasVideo: true, chapters }));
      if (u.endsWith(`/assets/${REC}/media`))
        return new Response(new Uint8Array(4), { headers: { "content-type": "video/webm" } });
      return new Response("{}", { status: 404 });
    });
    const api = createReplayApi(fake.host, fetchImpl as unknown as typeof fetch);
    const meta = await api.getRecording(REC).catch(() => null);
    expect(meta?.leader?.name, "the public read answered").toBe("Rav");
    await api.getState(REC);
    expect((await api.getManifest!(REC))?.chapters).toHaveLength(2);
    await api.getMedia(REC);
    expect(urls.map((u) => u.replace(/^.*\/api\/v1/, ""))).toEqual([
      `/assets/${REC}`,
      `/assets/${REC}/state`,
      `/assets/${REC}/manifest`,
      `/assets/${REC}/media`,
    ]);
  });

  // @feature SHIUR-006 The shiur player: a bar with chapters, the talking head in place, open to anyone
  // @ac 053/AC-005
  it("plays and pauses with Space and moves 5 seconds with the arrows, in the reading direction", async () => {
    const { q, key, media } = await setup();
    expect(q("[data-replay-bar]"), "the player bar").not.toBeNull();
    await key("[data-replay-bar]", " ");
    expect(media.paused).toBe(false);
    await key("[data-replay-bar]", " ");
    expect(media.paused).toBe(true);
    await key("[data-replay-bar]", "ArrowRight");
    expect(media.currentTime).toBe(5);
    await key("[data-replay-bar]", "ArrowLeft");
    expect(media.currentTime).toBe(0);
    // On the seek bar too: Space plays, the arrows move 5 seconds.
    await key("[data-action=replay-scrub]", "ArrowRight");
    expect(media.currentTime).toBe(5);
    await key("[data-action=replay-scrub]", " ");
    expect(media.paused).toBe(false);
  });
});
