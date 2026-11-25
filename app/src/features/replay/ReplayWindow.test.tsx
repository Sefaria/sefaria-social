// @vitest-environment jsdom
// The replay in the floating window (spec 042): the loading bar, the transport driving the player, "You left the recording" and
// Back to the recording, and the error. The fake host's reader state API, a fake recordings API with the real API's methods and
// a fake media element that is its own clock. Modules load through import.meta.glob so that, on a base without them, the first
// assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as WindowModule from "./ReplayWindow";
import type * as ControllerModule from "./replay-controller";
import type * as FixtureModule from "./test-track";
import type * as ApiModule from "./replay-api";
import type * as CallModule from "~/features/av/call-controller";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";

const mods = {
  window: import.meta.glob<typeof WindowModule>("./ReplayWindow.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("./replay-controller.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
  call: import.meta.glob<typeof CallModule>("../av/call-controller.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
};

const REC = "9b1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

async function setup(opts: { state?: unknown; holdMedia?: boolean; lang?: "english" | "hebrew" } = {}) {
  const windowMod = await mods.window["./ReplayWindow.tsx"]?.();
  expect(windowMod, "app/src/features/replay/ReplayWindow.tsx exists").toBeDefined();
  const { replayControllerFor } = (await mods.controller["./replay-controller.ts"]!())!;
  const { createFakeMedia, trackJson, flush } = (await mods.fixture["./test-track.ts"]!())!;
  const { callControllerFor } = (await mods.call["../av/call-controller.ts"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const fake = createFakeHost({
    url: `/Genesis.1?ctx=social.rec.${REC}`,
    viewer: { id: 4242, name: "Test Learner" },
    ui: { interfaceLang: opts.lang ?? "english" },
  });
  const calls = callControllerFor(fake.host, {
    api: { getCallToken: vi.fn() },
    loadEngine: vi.fn(),
    sessions: { acquire: () => () => undefined },
    rooms: { onLeave: () => () => undefined },
  });
  teardown.push(() => calls.dispose());
  let releaseMedia: () => void = () => undefined;
  let progress: ((loaded: number, total: number | null) => void) | undefined;
  const api: ApiModule.ReplayApi = {
    listRecordings: vi.fn(async () => []),
    deleteRecording: vi.fn(async () => undefined),
    getRecording: vi.fn(async () => ({ id: REC, durationMs: 20_000, mediaBytes: 10 })),
    getState: vi.fn(async () => opts.state ?? trackJson()),
    getMedia: vi.fn(async (_id, o) => {
      progress = o?.onProgress;
      progress?.(0, 10);
      if (opts.holdMedia) await new Promise<void>((resolve) => (releaseMedia = resolve));
      return new Blob([new Uint8Array(10)]);
    }),
  };
  const media = createFakeMedia();
  const replay = replayControllerFor(fake.host, {
    api,
    createMedia: () => media,
    objectUrls: { create: () => "blob:replay", revoke: () => undefined },
  });
  const view = await render(createElement(HostContext.Provider, { value: fake.host }, createElement(windowMod!.ReplayWindow)));
  teardown.push(view.unmount);
  teardown.push(() => replay.close());
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const press = async (sel: string) => {
    const el = q(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
    await act(flush);
  };
  return { fake, replay, media, api, q, press, flush, progress: (l: number) => progress?.(l, 10), release: () => releaseMedia() };
}

describe("the replay window (spec 042)", () => {
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-002
  it("opens in the floating window with a loading bar that follows the media's progress, then the player at 0", async () => {
    const s = await setup({ holdMedia: true });
    let opened!: Promise<void>;
    await act(async () => {
      opened = s.replay.open(REC, { autoplay: false });
      await s.flush();
    });
    const win = s.q("[data-call-window]");
    expect(win?.getAttribute("data-window-owner")).toBe("replay");
    expect(win?.getAttribute("aria-label")).toBe("Recording player");
    const bar = s.q<HTMLProgressElement>('[data-call-window] [role="progressbar"], [data-call-window] progress');
    expect(bar?.getAttribute("aria-label")).toBe("Loading the recording");
    await act(async () => s.progress(5));
    expect(s.q<HTMLProgressElement>("[data-call-window] progress")?.value).toBe(0.5);
    await act(async () => {
      s.release();
      await opened;
    });
    expect(s.q("[data-social-replay]")?.getAttribute("data-social-replay")).toBe("ready");
    expect(s.q("[data-call-window] progress")).toBeNull();
    expect(s.q("[data-replay-time]")?.textContent).toBe("0:00 / 0:20");
    expect(s.media.paused).toBe(true);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-004
  it("the transport plays, pauses, scrubs, skips 10 seconds and changes speed on the media", async () => {
    const s = await setup();
    await act(async () => s.replay.open(REC, { autoplay: false }));
    const scrub = s.q<HTMLInputElement>('input[type="range"][data-action="replay-scrub"]');
    expect(scrub?.getAttribute("aria-label")).toBe("Position in the recording");
    expect([...document.querySelectorAll("[data-keyframe]")].map((o) => o.getAttribute("value"))).toEqual(["0", "10000"]);

    await s.press('[data-action="replay-play"]');
    expect(s.media.paused).toBe(false);
    expect(s.q('[data-action="replay-pause"]')?.textContent).toBe("Pause");
    await s.press('[data-action="replay-pause"]');
    expect(s.media.paused).toBe(true);

    await s.press('[data-action="replay-forward"]');
    expect(s.media.currentTime).toBe(10);
    await s.press('[data-action="replay-back"]');
    expect(s.media.currentTime).toBe(0);
    expect(s.q('[data-action="replay-forward"]')?.getAttribute("aria-label")).toBe("Forward 10 seconds");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(scrub, "12000");
      scrub!.dispatchEvent(new Event("input", { bubbles: true }));
      await s.flush();
    });
    expect(s.media.currentTime).toBe(12);
    expect(s.q("[data-replay-time]")?.textContent).toBe("0:12 / 0:20");

    await s.press('[data-rate="1.5"]');
    expect(s.media.playbackRate).toBe(1.5);
    expect(s.q('[data-rate="1.5"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(s.q('[data-rate="1"]')?.getAttribute("aria-pressed")).toBe("false");
    await s.press('[data-rate="2"]');
    expect(s.media.playbackRate).toBe(2);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-005
  it("says the person left the recording after reading around, and Back to the recording follows it again", async () => {
    const s = await setup();
    await act(async () => s.replay.open(REC, { autoplay: false }));
    expect(s.q("[data-replay-left]")).toBeNull();
    await act(async () => {
      s.fake.localInput();
      await s.flush();
    });
    expect(s.q("[data-replay-left]")?.textContent).toContain("You left the recording");
    expect(s.q('[data-action="replay-rejoin"]')?.textContent).toBe("Back to the recording");
    await s.press('[data-action="replay-rejoin"]');
    expect(s.q("[data-replay-left]")).toBeNull();
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-008
  it("says the recording could not be played, and Close closes the window", async () => {
    const s = await setup({ state: { v: 1, nope: true } });
    await act(async () => s.replay.open(REC, { autoplay: false }));
    expect(s.q('[data-call-window] [role="alert"]')?.textContent).toBe("This recording could not be played");
    await s.press('[data-action="replay-close"]');
    expect(s.q("[data-call-window]")).toBeNull();
    expect(s.replay.view().kind).toBe("closed");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-002
  it("speaks Hebrew in a Hebrew interface", async () => {
    const s = await setup({ lang: "hebrew" });
    await act(async () => s.replay.open(REC, { autoplay: false }));
    expect(s.q("[data-call-window]")?.getAttribute("aria-label")).toBe("נגן ההקלטה");
    expect(s.q('[data-action="replay-close"]')?.getAttribute("aria-label")).toBe("סגירת ההקלטה");
  });
});
