// @vitest-environment jsdom
// Spec 041's interface: the Recording badge, the pre-join notice and the owner's Record button, rendered with the fake host, the
// fake media engine and a fake rooms API with the real API's methods. The new modules load through import.meta.glob so that,
// on a base without them, the first assertion fails instead of the import.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as BadgeModule from "./RecordingBadge";
import type * as ButtonModule from "./RecordButton";
import type * as ControllerModule from "./recording-controller";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as CallModule from "~/features/av/call-controller";
import type * as MediaModule from "~/features/av/test-media";
import type * as PreJoinModule from "~/features/av/PreJoin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mods = {
  badge: import.meta.glob<typeof BadgeModule>("./RecordingBadge.tsx"),
  button: import.meta.glob<typeof ButtonModule>("./RecordButton.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("./recording-controller.ts"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../api/rooms-api.ts"),
  call: import.meta.glob<typeof CallModule>("../av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../av/test-media.ts"),
  prejoin: import.meta.glob<typeof PreJoinModule>("../av/PreJoin.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

async function render(node: ReactNode) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  teardown.push(() => {
    act(() => root.unmount());
    el.remove();
  });
  return el;
}

async function load<T>(glob: Record<string, () => Promise<T>>, path: string): Promise<T> {
  const mod = await glob[path]?.();
  expect(mod, `${path} exists`).toBeDefined();
  return mod!;
}

describe("the Recording badge and notices (spec 041)", () => {
  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-006
  it("shows a Recording status in the interface language while on, and nothing when off", async () => {
    const { RecordingBadge } = await load(mods.badge, "./RecordingBadge.tsx");
    const { HostContext } = await load(mods.host, "../host/host-context.tsx");
    const hebrew = createFakeHost({ url: "/Genesis.1", ui: { interfaceLang: "hebrew" } });
    const on = await render(createElement(RecordingBadge, { on: true }));
    expect(on.querySelector("[data-recording-badge]")?.getAttribute("role")).toBe("status");
    expect(on.querySelector("[data-recording-badge]")?.textContent).toBe("Recording");
    const he = await render(
      createElement(HostContext.Provider, { value: hebrew.host }, createElement(RecordingBadge, { on: true })),
    );
    expect(he.querySelector("[data-recording-badge]")?.textContent).toBe("מקליטים");
    const off = await render(createElement(RecordingBadge, { on: false }));
    expect(off.innerHTML).toBe("");
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-006
  it("tells the pre-join step that the call is being recorded when the room's status says so", async () => {
    const { HostContext } = await load(mods.host, "../host/host-context.tsx");
    const { RoomsApiContext } = await load(mods.api, "../api/rooms-api.ts");
    const callMod = await load(mods.call, "../av/call-controller.ts");
    const { createFakeEngine } = await load(mods.media, "../av/test-media.ts");
    const { PreJoin } = await load(mods.prejoin, "../av/PreJoin.tsx");
    const notice = async (recording: boolean) => {
      const fake = createFakeHost({ url: "/Genesis.1", viewer: { id: 4242, name: "Test Learner" } });
      const status = { live: false, ref: null, heRef: null, title: null, participants: 0, ...(recording ? { recording } : {}) };
      const api = { getRoom: vi.fn(), join: vi.fn(), getStatus: vi.fn(async () => status) } as unknown as ApiModule.RoomsApi;
      const engine = createFakeEngine();
      const calls = callMod.callControllerFor(fake.host, {
        api,
        loadEngine: async () => engine,
        sessions: { acquire: () => () => undefined },
        rooms: { onLeave: () => () => undefined },
      });
      teardown.push(() => calls.dispose());
      await act(async () => calls.open(ID));
      const view = calls.view();
      expect(view.kind).toBe("prejoin");
      const el = await render(
        createElement(
          HostContext.Provider,
          { value: fake.host },
          createElement(
            RoomsApiContext.Provider,
            { value: api },
            createElement(PreJoin, { controller: calls, devices: view.kind === "prejoin" ? view.devices : (null as never) }),
          ),
        ),
      );
      await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
      expect(api.getStatus).toHaveBeenCalledWith(ID);
      return el.querySelector("[data-recording-notice]")?.textContent ?? null;
    };
    expect(await notice(true)).toBe("This call is being recorded");
    expect(await notice(false)).toBeNull();
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-008
  it("tells the owner when a recording stopped because the upload failed", async () => {
    const { RecordButton } = await load(mods.button, "./RecordButton.tsx");
    const controllerMod = await load(mods.controller, "./recording-controller.ts");
    const { HostContext } = await load(mods.host, "../host/host-context.tsx");
    const fake = createFakeHost({ url: "/Genesis.1", viewer: { id: 4242, name: "Test Learner" } });
    let fail: (() => void) | null = null;
    const stream = { getVideoTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream;
    const recording = controllerMod.recordingControllerFor(fake.host, {
      api: {
        start: vi.fn(async () => ({ kind: "ok" as const, id: "rec-1" })),
        putMedia: vi.fn(),
        putState: vi.fn(),
        finish: vi.fn(),
      },
      call: { media: () => null, subscribe: () => () => undefined },
      roomTitle: async () => "Daf Yomi",
      reader: () => fake.host.reader.state as never,
      createMixer: () => ({ stream, setTracks: () => undefined, dispose: () => undefined }),
      createCompositor: () => ({ stream, start: () => undefined, stop: () => undefined, draw: () => undefined }),
      createRecorder: (o) => {
        fail = () => o.onChange?.("failed");
        return {
          start: () => undefined,
          stop: async () => undefined,
          status: () => "recording",
          elapsed: () => 0,
          mimeType: () => "",
        };
      },
    });
    teardown.push(() => recording.dispose());
    const el = await render(
      createElement(HostContext.Provider, { value: fake.host }, createElement(RecordButton, { roomId: ID })),
    );
    const button = () => el.querySelector<HTMLButtonElement>("button[data-action]");
    expect(button()?.textContent).toBe("Record");
    await act(async () => button()!.click());
    await vi.waitFor(() => expect(button()?.textContent).toBe("Stop recording"));
    expect(el.querySelector("[data-recording-elapsed]")?.textContent).toBe("Recording 00:00");
    await act(async () => fail!());
    expect(el.querySelector("[role=alert]")?.textContent).toBe("Recording stopped: the upload failed");
    expect(button()?.textContent).toBe("Record");
  });
});
