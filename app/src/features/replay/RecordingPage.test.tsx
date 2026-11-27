// @vitest-environment jsdom
// A recording's page (spec 042 AC-001): title, date, length, Play, Download state, and Delete only for whoever may delete it.
// The fake host, a fake recordings API and a fake rooms API with the real APIs' methods. Modules load through import.meta.glob
// so that, on a base without them, the first assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as PageModule from "./RecordingPage";
import type * as UseReplayModule from "./use-replay";
import type * as ApiModule from "./replay-api";
import type * as FixtureModule from "./test-track";
import type * as RoomsApiModule from "~/features/api/rooms-api";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";

const mods = {
  page: import.meta.glob<typeof PageModule>("./RecordingPage.tsx"),
  use: import.meta.glob<typeof UseReplayModule>("./use-replay.ts"),
  api: import.meta.glob<typeof ApiModule>("./replay-api.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
  rooms: import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
};

const REC = "9b1c2d3e-4b5a-4c6d-8e7f-001122334455";
const ROOM = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const VIEWER = 4242;
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
});

const recording = (patch: Record<string, unknown> = {}) => ({
  id: REC,
  roomId: ROOM,
  title: "Shiur on Bereshit",
  status: "ready",
  startedAt: "2026-11-01T12:00:00.000Z",
  durationMs: 3_725_000,
  mediaBytes: 10,
  mime: "video/webm",
  owner: { userId: 5151, name: "Owner" },
  canDelete: false,
  ...patch,
});

async function setup(opts: { meta?: Record<string, unknown> | "missing"; role?: "owner" | "member" } = {}) {
  const pageMod = await mods.page["./RecordingPage.tsx"]?.();
  expect(pageMod, "app/src/features/replay/RecordingPage.tsx exists").toBeDefined();
  const { ReplayApiContext } = (await mods.use["./use-replay.ts"]!())!;
  const { ReplayApiError } = (await mods.api["./replay-api.ts"]!())!;
  const { trackJson } = (await mods.fixture["./test-track.ts"]!())!;
  const { RoomsApiContext } = (await mods.rooms["../api/rooms-api.ts"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const fake = createFakeHost({ url: `/social/rec/${REC}`, viewer: { id: VIEWER, name: "Test Learner" } });
  const api: ApiModule.ReplayApi = {
    listRecordings: vi.fn(async () => []),
    deleteRecording: vi.fn(async () => undefined),
    getRecording: vi.fn(async () => {
      if (opts.meta === "missing") throw new ReplayApiError(404);
      return recording(opts.meta);
    }),
    getState: vi.fn(async () => trackJson()),
    getMedia: vi.fn(async () => new Blob()),
  };
  const rooms = {
    getRoom: vi.fn(async () => ({
      kind: "member" as const,
      room: { id: ROOM, title: "Room", ownerUserId: 5151, role: opts.role ?? "member", createdAt: "", updatedAt: "" },
    })),
    join: vi.fn(),
  } as unknown as RoomsApiModule.RoomsApi;
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(
        RoomsApiContext.Provider,
        { value: rooms },
        createElement(ReplayApiContext.Provider, { value: api }, createElement(pageMod!.RecordingPage, { recordingId: REC })),
      ),
    ),
  );
  teardown.push(view.unmount);
  const main = () => view.el.querySelector<HTMLElement>("main[data-social-page=recording]");
  await vi.waitFor(() => expect(main()?.dataset.recordingState).not.toBe("loading"));
  const q = <T extends Element = HTMLElement>(sel: string) => view.el.querySelector<T>(sel);
  return { fake, api, rooms, main, q };
}

describe("a recording's page (spec 042)", () => {
  // @feature SHIUR-008 Revisit a finished shiur through its texts and transcript
  // @ac 061/AC-004
  it("links back to Social and the recording's room", async () => {
    const s = await setup();
    expect(s.q('a[href="/social"]')?.textContent).toBe("Back to Social");
    expect(s.q(`a[href="/social/r/${ROOM}"]`)?.textContent).toBe("Back to the room");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("shows the title, date, length, Play and Download state, and no Delete for a member who did not record it", async () => {
    const s = await setup();
    expect(s.main()?.dataset.recordingState).toBe("ready");
    expect(s.q("h1")?.textContent).toBe("Shiur on Bereshit");
    expect(s.q("[data-recording-date]")?.textContent).toBe("Nov 1, 2026");
    expect(s.q("[data-recording-length]")?.textContent).toBe("1:02:05");
    expect(s.q('button[data-action="play-recording"]')?.textContent).toBe("Play");
    expect(s.q('button[data-action="download-state"]')?.textContent).toBe("Download state");
    expect(s.q('button[data-action="delete-recording"]')).toBeNull();
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("names an untitled recording by its date", async () => {
    const s = await setup({ meta: { title: null, durationMs: 65_000 } });
    expect(s.q("h1")?.textContent).toBe("Recording of Nov 1, 2026");
    expect(s.q("[data-recording-length]")?.textContent).toBe("1:05");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("offers Delete to the recording's recorder and to the room's owner, with a confirmation", async () => {
    const recorder = await setup({ meta: { owner: { userId: VIEWER, name: "Test Learner" } } });
    expect(recorder.q('button[data-action="delete-recording"]')?.textContent).toBe("Delete");
    teardown.pop()!();

    const roomOwner = await setup({ role: "owner" });
    expect(roomOwner.rooms.getRoom).toHaveBeenCalledWith(ROOM);
    await act(async () => roomOwner.q<HTMLButtonElement>('button[data-action="delete-recording"]')!.click());
    expect(roomOwner.q("[data-confirm-delete] p")?.textContent).toBe("Delete this recording? This cannot be undone.");
    expect(roomOwner.api.deleteRecording).not.toHaveBeenCalled();
    await act(async () => roomOwner.q<HTMLButtonElement>('button[data-action="confirm-delete"]')!.click());
    expect(roomOwner.api.deleteRecording).toHaveBeenCalledWith(REC);
    await vi.waitFor(() => expect(roomOwner.main()?.dataset.recordingState).toBe("deleted"));
    expect(roomOwner.q('[role="status"]')?.textContent).toBe("Recording deleted.");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("Download state saves the state track as sefaria-recording-<date>.json", async () => {
    const s = await setup();
    const blobs: Blob[] = [];
    const created = vi.fn((b: Blob) => (blobs.push(b), "blob:state"));
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const saved: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.getAttribute("href") ?? "" });
    });
    await act(async () => s.q<HTMLButtonElement>('button[data-action="download-state"]')!.click());
    await vi.waitFor(() => expect(saved).toEqual([{ name: "sefaria-recording-2026-11-01.json", href: "blob:state" }]));
    expect(s.api.getState).toHaveBeenCalledWith(REC);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]!);
    });
    expect(blobs[0]!.type).toBe("application/json");
    expect(JSON.parse(text).messages[0].snapshot.url).toBe("/Genesis.1");
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("says the recording is not available when it cannot be read", async () => {
    const s = await setup({ meta: "missing" });
    expect(s.main()?.dataset.recordingState).toBe("not-found");
    expect(s.q('[role="alert"]')?.textContent).toBe("This recording is not available");
    expect(s.q('button[data-action="play-recording"]')).toBeNull();
  });
});
