// @vitest-environment jsdom
// Spec 037: on a phone the call docks as a strip under the reader's top inset; it collapses to 48px (no video) and expands to
// the active speaker; rotating switches between strip and window without touching the call; a call paused in the background
// resumes with one tap. jsdom has no layout, so the frame is read from its attributes and inline style.
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
  strip: import.meta.glob("../features/av/CallStrip.tsx"),
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
const width0 = window.innerWidth;
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  setWidth(width0);
  localStorage.clear();
});

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

async function onPhone() {
  expect(Object.keys(mods.strip), "app/src/features/av/CallStrip.tsx exists").toEqual(["../features/av/CallStrip.tsx"]);
  const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  setWidth(390);
  const fake = createFakeHost({
    url: "/Genesis.1",
    viewer: { id: 4242, name: "Test Learner" },
    chrome: { top: 56, inlineStart: 0, inlineEnd: 0, bottom: 0 },
  } as never);
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
  const call = engine.last();
  await act(async () =>
    call.setRemote([
      { id: "u:5151", name: "Avi Owner", mic: true, camera: true, screen: false, speaking: true },
      { id: "u:6161", name: "Dana", mic: false, camera: true, screen: false, speaking: false },
    ]),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-call-strip]")).not.toBeNull());
  const strip = () => document.querySelector<HTMLElement>("[data-call-strip]");
  const press = async (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
  };
  return { fake, engine, call, calls, strip, press };
}

describe("the call on a phone", () => {
  // @feature SESS-062 The call on a phone: a docked strip
  // @ac 037/AC-001
  it("docks as a full-width strip under the top inset, with no drag or resize handle", async () => {
    const t = await onPhone();
    expect(t.strip()!.style.top).toBe("56px");
    expect([t.strip()!.style.left, t.strip()!.style.right]).toEqual(["0px", "0px"]);
    expect(document.querySelector("[data-call-window]")).toBeNull();
    expect(document.querySelector('[data-action="call-window-handle"]')).toBeNull();
    expect(document.querySelector('[data-action="call-window-resize"]')).toBeNull();
  });

  // @feature SESS-062 The call on a phone: a docked strip
  // @ac 037/AC-002
  it("is 48px with avatars, speaking, microphone, Leave and Expand; expanded it shows the active speaker at 16:9", async () => {
    const t = await onPhone();
    expect(t.strip()!.dataset.expanded).toBe("false");
    expect(t.strip()!.style.height).toBe("48px");
    for (const sel of [
      "[data-pill-participant]",
      '[data-speaking="true"]',
      '[data-action="mic"]',
      '[data-action="leave-call"]',
      '[data-action="expand-call"]',
    ])
      expect(t.strip()!.querySelector(sel), sel).not.toBeNull();
    await t.press('[data-action="expand-call"]');
    expect(t.strip()!.dataset.expanded).toBe("true");
    const tiles = t.strip()!.querySelectorAll("[data-participant]");
    expect([...tiles].map((el) => el.getAttribute("data-participant"))).toEqual(["u:5151"]);
    expect(t.strip()!.querySelector("[data-strip-speaker]")?.getAttribute("data-aspect")).toBe("16:9");
    await t.press('[data-action="collapse-call"]');
    expect([t.strip()!.dataset.expanded, t.strip()!.style.height]).toEqual(["false", "48px"]);
  });

  // @feature SESS-062 The call on a phone: a docked strip
  // @ac 037/AC-003
  it("switches between strip and window when the screen crosses 600px, without disconnecting", async () => {
    const t = await onPhone();
    await act(async () => setWidth(900));
    await vi.waitFor(() => expect(document.querySelector("[data-call-window]")).not.toBeNull());
    expect(t.strip()).toBeNull();
    await act(async () => setWidth(390));
    await vi.waitFor(() => expect(t.strip()).not.toBeNull());
    expect([t.engine.connections.length, t.call.disconnected, t.calls.view().kind]).toEqual([1, false, "in-call"]);
  });

  // @feature SESS-062 The call on a phone: a docked strip
  // @ac 037/AC-005
  it("receives no video while collapsed", async () => {
    const t = await onPhone();
    expect(t.call.visible).toEqual([]);
    await t.press('[data-action="expand-call"]');
    expect(t.call.visible).toEqual(["u:5151"]);
    await t.press('[data-action="collapse-call"]');
    expect(t.call.visible).toEqual([]);
  });

  // @feature SESS-062 The call on a phone: a docked strip
  // @ac 037/AC-004
  it("after the browser paused the tab's audio, says so and resumes with one tap", async () => {
    const t = await onPhone();
    expect(document.querySelector("[data-call-paused]")).toBeNull();
    await act(async () => t.call.blockAudio(true));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    const notice = document.querySelector("[data-call-paused]");
    expect(notice?.textContent).toContain("paused");
    await t.press('[data-call-paused] [data-action="resume-call"]');
    expect(t.call.calls.startAudio).toBe(1);
    expect(document.querySelector("[data-call-paused]")).toBeNull();
  });
});
