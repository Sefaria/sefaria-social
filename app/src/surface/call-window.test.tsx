// @vitest-environment jsdom
// Spec 035: the call window around the panel: sizes and tiles, keyboard moves and the menu, Escape, reduced motion, and which
// participants send video. jsdom has no layout, so the window's box is read from its inline style (left, top, width, height),
// which the geometry functions compute; real layout (the text column never moving, dragging, resizing) is e2e/call-window.spec.ts.
// App modules load through import.meta.glob so that, on a base without them, the first assertion fails.
import { readFileSync } from "node:fs";
import path from "node:path";
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
  window: import.meta.glob("../features/av/CallWindow.tsx"),
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

const remote = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `u:${9000 + i}`,
    name: `Learner ${i + 1}`,
    mic: i % 2 === 0,
    camera: true,
    screen: false,
    speaking: i === 0,
  }));

async function inCall(opts: { participants?: number; lang?: "english" | "hebrew" } = {}) {
  expect(Object.keys(mods.window), "app/src/features/av/CallWindow.tsx exists").toEqual(["../features/av/CallWindow.tsx"]);
  const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  const fake = createFakeHost({
    url: "/Genesis.1",
    viewer: { id: 4242, name: "Test Learner" },
    ui: { interfaceLang: opts.lang ?? "english" },
  });
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
  const sessions = { acquire: () => () => undefined };
  const rooms = { onLeave: () => () => undefined };
  const calls = callMod.callControllerFor(fake.host, { api, loadEngine: async () => engine, sessions, rooms });
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
  await act(async () => call.setRemote(remote((opts.participants ?? 11) - 1)));
  const win = () => document.querySelector<HTMLElement>("[data-call-window]")!;
  // the call interface is its own chunk (CallSlot): wait for it to load
  await vi.waitFor(() => expect(document.querySelector("[data-call-window] [data-participant]")).not.toBeNull());
  const box = () => {
    const s = win().style;
    return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) };
  };
  const press = async (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
  };
  const key = async (el: Element, k: string, shiftKey = false) => {
    let ev!: KeyboardEvent;
    await act(async () => {
      ev = new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
    });
    return ev;
  };
  const size = async (s: string) => {
    await press('[data-action="call-window-menu"]');
    await press(`[data-size-to="${s}"]`);
  };
  return { fake, engine, call, calls, win, box, press, key, size };
}

/** The window's stylesheet as written (jsdom applies no CSS modules, so the rules are read, not computed). */
const windowCss = () => readFileSync(path.join(process.cwd(), "app/src/features/av/window.module.css"), "utf8");

const tiles = () => document.querySelectorAll("[data-call-window] [data-participant]").length;
const more = () => document.querySelector("[data-more-participants]")?.textContent ?? null;

describe("the call window while the room is recorded (spec 041)", () => {
  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-006
  it("shows a Recording badge in the window and the pill while the media server says so, and removes it when it stops", async () => {
    const { call, win, size } = await inCall({ participants: 3 });
    const play = call as unknown as { setRecording?: (on: boolean) => void };
    expect(typeof play.setRecording, "the call can be told the room is recorded").toBe("function");
    expect(win().querySelector("[data-recording-badge]")).toBeNull();
    await act(async () => play.setRecording!(true));
    expect(win().querySelector("[data-recording-badge]")?.textContent).toBe("Recording");
    await size("pill");
    expect(win().querySelector("[data-call-pill] [data-recording-badge]")?.getAttribute("role")).toBe("status");
    await act(async () => play.setRecording!(false));
    expect(document.querySelector("[data-recording-badge]")).toBeNull();
  });
});

describe("the call window", () => {
  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-003
  it("shows the pill, small, medium and large sizes with the tiles each holds and +N for the rest", async () => {
    const t = await inCall({ participants: 11 });
    expect(t.win().dataset.size).toBe("small");
    expect([tiles(), more()]).toEqual([4, "+7"]);
    await t.size("medium");
    expect([t.win().dataset.size, tiles(), more()]).toEqual(["medium", 4, "+7"]);
    await t.size("large");
    expect([t.win().dataset.size, tiles(), more()]).toEqual(["large", 9, "+2"]);
    expect(t.box().width).toBeLessThanOrEqual(0.6 * window.innerWidth);
    expect(t.box().height).toBeLessThanOrEqual(0.6 * window.innerHeight);
    await t.size("pill");
    expect(t.win().dataset.size).toBe("pill");
    expect(tiles()).toBe(0);
    expect(document.querySelectorAll("[data-call-pill] [data-pill-participant]").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-call-pill] [data-speaking="true"]')).not.toBeNull();
    expect(document.querySelector('[data-call-pill] [data-action="mic"]')).not.toBeNull();
    await t.press('[data-action="expand-call"]');
    expect(t.win().dataset.size).toBe("small");
  });

  // @feature SESS-061 Call window by keyboard and screen reader
  // @ac 035/AC-008
  it("moves by arrow keys from the handle, by the menu's corners, and announces each move politely", async () => {
    const t = await inCall();
    const handle = document.querySelector('[data-action="call-window-handle"]')!;
    expect(handle.tagName).toBe("BUTTON");
    const start = t.box();
    await t.key(handle, "ArrowLeft");
    expect(t.box().left).toBe(start.left - 16);
    await t.key(handle, "ArrowDown", true);
    expect(t.box().top).toBe(start.top + 64);
    const status = document.querySelector("[data-call-window-status]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("moved");

    await t.press('[data-action="call-window-menu"]');
    expect(document.querySelector('[data-action="call-window-menu"]')?.getAttribute("aria-expanded")).toBe("true");
    await t.press('[data-move-to="bottom-left"]');
    expect(t.win().dataset.corner).toBe("bottom-start");
    expect(t.box().left).toBe(16);
    expect(t.box().top + t.box().height).toBe(window.innerHeight - 16);
    expect(status.textContent).toContain("bottom left");
  });

  // @feature SESS-061 Call window by keyboard and screen reader
  // @ac 035/AC-009
  it("does not trap focus, collapses to the pill on Escape, and names every control", async () => {
    const t = await inCall();
    const buttons = [...t.win().querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim(), b.outerHTML).not.toBe("");
    const tab = await t.key(buttons.at(-1)!, "Tab");
    expect(tab.defaultPrevented, "Tab leaves the window").toBe(false);
    expect(t.win().getAttribute("aria-modal")).not.toBe("true");
    await t.key(buttons[0]!, "Escape");
    expect(t.win().dataset.size).toBe("pill");
    const css = windowCss();
    expect(css).toMatch(/min-width:\s*24px/);
    expect(css).toMatch(/min-height:\s*24px/);
    expect(css).toMatch(/:focus-visible/);
  });

  // @feature SESS-061 Call window by keyboard and screen reader
  // @ac 035/AC-010
  it("turns off movement and size animation for people who prefer reduced motion", async () => {
    await inCall();
    const css = windowCss();
    expect(css).toMatch(/transition:[^;]*(transform|width)/);
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(reduced).toMatch(/transition:\s*none/);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-011
  it("receives video only for participants whose tile is shown, and keeps everyone's audio", async () => {
    const t = await inCall({ participants: 11 });
    await t.size("large");
    expect(t.call.visible).toHaveLength(8); // nine tiles, one of them the viewer's own
    await t.size("pill");
    expect(t.call.visible).toEqual([]);
    expect(t.call.disconnected).toBe(false);
    await t.press('[data-action="expand-call"]');
    expect(t.call.visible).toHaveLength(3);
  });
});
