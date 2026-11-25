// @vitest-environment jsdom
// Spec 042 in the surface: a recording's page and the persistent mount together, against the fake host. Play navigates the
// reader to the recording's first text in its context and opens the player in the floating window (AC-002); with a call in the
// window, Play asks first and leaves the call on confirmation, and Join call during a replay asks to close it (AC-007); Back out
// of the recording's context closes the player. The fake call engine, a fake recordings API with the real API's methods, and a
// real <video> element whose play and pause are stubbed (jsdom has no media). App modules load through import.meta.glob so that,
// on a base without them, the first assertion fails.
import { act, createElement, Fragment } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as PageModule from "~/features/replay/RecordingPage";
import type * as UseReplayModule from "~/features/replay/use-replay";
import type * as ReplayModule from "~/features/replay/replay-controller";
import type * as ReplayApiModule from "~/features/replay/replay-api";
import type * as FixtureModule from "~/features/replay/test-track";
import type * as CallModule from "~/features/av/call-controller";
import type * as CallButtonModule from "~/features/av/CallButton";
import type * as MediaModule from "~/features/av/test-media";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as PersistentModule from "./persistent";

const mods = {
  page: import.meta.glob<typeof PageModule>("../features/replay/RecordingPage.tsx"),
  use: import.meta.glob<typeof UseReplayModule>("../features/replay/use-replay.ts"),
  replay: import.meta.glob<typeof ReplayModule>("../features/replay/replay-controller.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("../features/replay/test-track.ts"),
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  button: import.meta.glob<typeof CallButtonModule>("../features/av/CallButton.tsx"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const REC = "9b1c2d3e-4b5a-4c6d-8e7f-001122334455";
const ROOM = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

async function setup() {
  const pageMod = await mods.page["../features/replay/RecordingPage.tsx"]?.();
  expect(pageMod, "app/src/features/replay/RecordingPage.tsx exists").toBeDefined();
  const { ReplayApiContext } = (await mods.use["../features/replay/use-replay.ts"]!())!;
  const { replayControllerFor } = (await mods.replay["../features/replay/replay-controller.ts"]!())!;
  const { trackJson, flush } = (await mods.fixture["../features/replay/test-track.ts"]!())!;
  const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
  const { CallButton } = (await mods.button["../features/av/CallButton.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;

  const fake = createFakeHost({ url: `/social/rec/${REC}`, viewer: { id: 4242, name: "Test Learner" } });
  const engine = createFakeEngine();
  const rooms = {
    getRoom: vi.fn(async () => ({
      kind: "member" as const,
      room: {
        id: ROOM,
        title: "Room",
        ownerUserId: 5151,
        role: "member",
        createdAt: "",
        updatedAt: "",
        calls: { available: true },
      },
    })),
    join: vi.fn(),
    getCallToken: vi.fn(async () => ({
      kind: "ok" as const,
      url: "wss://lk.test",
      token: "t",
      expiresAt: "2026-11-24T00:10:00Z",
    })),
  };
  const calls = callMod.callControllerFor(fake.host, {
    api: rooms,
    loadEngine: async () => engine,
    sessions: { acquire: () => () => undefined },
    rooms: { onLeave: () => () => undefined },
  });
  teardown.push(() => calls.dispose());
  const api: ReplayApiModule.ReplayApi = {
    listRecordings: vi.fn(async () => []),
    deleteRecording: vi.fn(async () => undefined),
    getRecording: vi.fn(async () => ({
      id: REC,
      roomId: ROOM,
      title: "Shiur",
      status: "ready",
      startedAt: "2026-11-01T12:00:00.000Z",
      durationMs: 20_000,
      mediaBytes: 10,
    })),
    getState: vi.fn(async () => trackJson()),
    getMedia: vi.fn(async () => new Blob([new Uint8Array(10)])),
  };
  const video = document.createElement("video");
  const play = vi.fn(async () => undefined);
  Object.assign(video, { play, pause: vi.fn() });
  const replay = replayControllerFor(fake.host, {
    api,
    createMedia: () => video,
    objectUrls: { create: () => "blob:replay", revoke: () => undefined },
  });
  teardown.push(() => replay.close());

  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(
        RoomsApiContext.Provider,
        { value: rooms as unknown as ApiModule.RoomsApi },
        createElement(
          ReplayApiContext.Provider,
          { value: api },
          createElement(
            Fragment,
            null,
            createElement(pageMod!.RecordingPage, { recordingId: REC }),
            createElement(CallButton, { roomId: ROOM, available: true }),
            createElement(PersistentView, { host: fake.host }),
          ),
        ),
      ),
    ),
  );
  teardown.push(view.unmount);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-recording-state]")?.getAttribute("data-recording-state")).toBe("ready"),
  );
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const press = async (sel: string) => {
    const el = q(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
    await act(flush);
  };
  const inCall = async () => {
    await act(async () => calls.open(ROOM));
    await act(async () => calls.join());
    await vi.waitFor(() => expect(q('[data-call-window][data-window-owner="call"] [data-social-call="in-call"]')).not.toBeNull());
  };
  return { fake, engine, calls, replay, video, play, q, press, inCall, flush };
}

const windows = () =>
  [...document.querySelectorAll("[data-call-window], [data-call-strip]")].map((w) => w.getAttribute("data-window-owner"));

describe("replaying a recording in the reader (spec 042)", () => {
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-002
  it("Play navigates the reader to the first text with ctx=social.rec.<id> and plays the video in the floating window from 0", async () => {
    const s = await setup();
    await s.press('button[data-action="play-recording"]');
    expect(s.fake.calls.navigate.map((n) => n.to)).toEqual([`/Genesis.1?ctx=social.rec.${REC}`]);
    expect(s.fake.url()).toBe(`/Genesis.1?ctx=social.rec.${REC}`);
    await vi.waitFor(() => expect(s.q('[data-call-window] [data-social-replay="ready"]')).not.toBeNull());
    expect(windows()).toEqual(["replay"]);
    expect(s.q("[data-call-window] [data-replay-media] video")).toBe(s.video);
    expect(s.video.src).toBe("blob:replay");
    expect(s.play).toHaveBeenCalledTimes(1);
    expect(s.replay.player()?.view().t).toBe(0);
    expect(s.q("[data-replay-time]")?.textContent).toBe("0:00 / 0:20");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-006
  it("Back out of the recording's context closes the player and leaves the reader where it is", async () => {
    const s = await setup();
    await s.press('button[data-action="play-recording"]');
    await vi.waitFor(() => expect(s.q('[data-social-replay="ready"]')).not.toBeNull());
    await act(async () => s.fake.back());
    await act(s.flush);
    expect(s.replay.view().kind).toBe("closed");
    expect(windows()).toEqual([]);
    expect(s.fake.url()).toBe(`/social/rec/${REC}`);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-007
  it("with a call in the window, Play asks first: Cancel keeps the call, Confirm leaves it and plays", async () => {
    const s = await setup();
    await s.inCall();
    await s.press('button[data-action="play-recording"]');
    const prompt = s.q('[data-call-window][data-window-owner="call"] [data-window-prompt="replay"]');
    expect(prompt?.getAttribute("role")).toBe("alertdialog");
    expect(prompt?.querySelector("p")?.textContent).toBe("Leave the call to play this recording?");
    expect(s.fake.calls.navigate).toEqual([]);

    await s.press('[data-action="cancel-window"]');
    expect(s.q("[data-window-prompt]")).toBeNull();
    expect(s.calls.view().kind).toBe("in-call");
    expect(s.fake.calls.navigate).toEqual([]);
    expect(s.replay.view().kind).toBe("closed");

    await s.press('button[data-action="play-recording"]');
    await s.press('[data-action="confirm-window"]');
    await vi.waitFor(() => expect(s.q('[data-social-replay="ready"]')).not.toBeNull());
    expect(s.calls.view().kind).toBe("off");
    expect(s.engine.last().disconnected).toBe(true);
    expect(s.fake.calls.navigate.map((n) => n.to)).toEqual([`/Genesis.1?ctx=social.rec.${REC}`]);
    expect(windows()).toEqual(["replay"]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-007
  it("Join call during a replay asks to close the recording first, and on Confirm closes it and opens the call", async () => {
    const s = await setup();
    await s.press('button[data-action="play-recording"]');
    await vi.waitFor(() => expect(s.q('[data-social-replay="ready"]')).not.toBeNull());
    await s.press('button[data-action="join-call"]');
    const prompt = s.q('[data-call-window][data-window-owner="replay"] [data-window-prompt="call"]');
    expect(prompt?.querySelector("p")?.textContent).toBe("Close the recording to join the call?");
    expect(s.calls.view().kind).toBe("off");

    await s.press('[data-action="confirm-window"]');
    await vi.waitFor(() => expect(s.calls.view().kind).toBe("prejoin"));
    expect(s.replay.view().kind).toBe("closed");
    await vi.waitFor(() => expect(windows()).toEqual(["call"]));
  });
});
