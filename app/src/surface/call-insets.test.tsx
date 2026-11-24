// @vitest-environment jsdom
// Spec 036: the call window keeps clear of the reader's chrome (SurfaceHost 1.2 ui.chrome), falls back on an older reader,
// and reports bad values once. The fake host plays the reader's insets. jsdom's viewport is 1024 by 768.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as CallModule from "~/features/av/call-controller";
import type * as MediaModule from "~/features/av/test-media";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as PersistentModule from "./persistent";

const mods = {
  insets: import.meta.glob<{ readChromeInsets?: unknown }>("../features/av/insets.ts"),
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

async function inCall(hostOptions: Parameters<typeof createFakeHost>[0]) {
  const insetsMod = await mods.insets["../features/av/insets.ts"]!();
  expect(insetsMod.readChromeInsets, "insets.ts reads the host's ui.chrome").toBeTypeOf("function");
  const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  const fake = createFakeHost({ url: "/Genesis.1", viewer: { id: 4242, name: "Test Learner" }, ...hostOptions });
  const engine = createFakeEngine();
  const api = {
    getRoom: vi.fn(),
    join: vi.fn(),
    getCallToken: vi.fn(async () => ({
      kind: "ok" as const,
      url: "wss://lk.test",
      token: "t",
      expiresAt: "2026-11-24T00:10:00Z",
    })),
  };
  const calls = callMod.callControllerFor(fake.host, {
    api,
    loadEngine: async () => engine,
    sessions: { acquire: () => () => undefined },
    rooms: { onLeave: () => () => undefined },
  });
  teardown.push(() => calls.dispose());
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(RoomsApiContext.Provider, { value: api }, createElement(PersistentView, { host: fake.host })),
    ),
  );
  teardown.push(view.unmount);
  await act(async () => calls.open(ID));
  await act(async () => calls.join());
  await vi.waitFor(() => expect(document.querySelector("[data-call-window]")).not.toBeNull());
  const box = () => {
    const s = document.querySelector<HTMLElement>("[data-call-window]")!.style;
    return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width) };
  };
  return { fake, box };
}

describe("the call window and the reader's chrome", () => {
  // @feature HOST-008 SurfaceHost 1.2 chrome insets for the call window
  // @ac 036/AC-002
  it("keeps inside the reader's insets and moves when they change", async () => {
    const t = await inCall({ chrome: { top: 60, inlineStart: 0, inlineEnd: 0, bottom: 0 } } as never);
    expect(t.box().top).toBe(60 + 16);
    expect(t.box().left + t.box().width).toBe(1024 - 16);
    await act(async () =>
      (t.fake as unknown as { setChrome(v: unknown): void }).setChrome({ top: 60, inlineStart: 0, inlineEnd: 420, bottom: 0 }),
    );
    expect(t.box().left + t.box().width).toBe(1024 - 420 - 16);
  });

  // @feature HOST-008 SurfaceHost 1.2 chrome insets for the call window
  // @ac 036/AC-003
  it("on an older reader without insets, keeps clear of a 64px header and nothing else, without an error", async () => {
    const t = await inCall({ chromeSupported: false } as never);
    expect(t.box().top).toBe(64 + 16);
    expect(t.box().left + t.box().width).toBe(1024 - 16);
    expect(t.fake.calls.report.filter((r) => r.name === "av.error")).toEqual([]);
  });

  // @feature HOST-008 SurfaceHost 1.2 chrome insets for the call window
  // @ac 036/AC-004
  it("uses the fallback for a bad value or a get that throws, and reports it once", async () => {
    const t = await inCall({ chrome: { top: -5, inlineStart: 0, inlineEnd: 0, bottom: 0 } } as never);
    expect(t.box().top).toBe(64 + 16);
    const chrome = (t.fake.host.ui as { chrome?: { get(): unknown } }).chrome!;
    chrome.get = () => {
      throw new Error("reader broke");
    };
    await act(async () =>
      (t.fake as unknown as { setChrome(v: unknown): void }).setChrome({ top: 99999, inlineStart: 0, inlineEnd: 0, bottom: 0 }),
    );
    expect(t.box().top).toBe(64 + 16);
    const errors = t.fake.calls.report.filter((r) => r.name === "av.error");
    expect(errors).toEqual([{ kind: "error", name: "av.error", data: { kind: "chrome_invalid" } }]);
  });
});
