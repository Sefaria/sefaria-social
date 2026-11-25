// @vitest-environment jsdom
// Spec 047: the call window's contents — tiles with the camera or initials and a name label, the icon control bar, the pre-join
// preview. Same harness as call.test.tsx: the fake host as the reader, the test relay, a fake media engine. App modules load
// through import.meta.glob so that, on a base without them, the first assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as CallModule from "~/features/av/call-controller";
import type * as MediaModule from "~/features/av/test-media";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as LobbyModule from "~/features/room/RoomLobbyPage";
import type * as ControllerModule from "~/features/session/controller";
import type * as PersistentModule from "./persistent";

const mods = {
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  relay: import.meta.glob<typeof RelayModule>("../features/session/test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  lobby: import.meta.glob<typeof LobbyModule>("../features/room/RoomLobbyPage.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("../features/session/controller.ts"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const CTX = `ctx=social.room.${ID}`;
const room = (available: boolean) => ({
  id: ID,
  title: "Daf Yomi",
  ownerUserId: 5151,
  role: "member" as const,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  calls: { available },
});

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
});

async function setup(url: string, opts: { available?: boolean; canShareScreen?: boolean } = {}) {
  const callMod = await mods.call["../features/av/call-controller.ts"]?.();
  expect(callMod, "app/src/features/av/call-controller.ts exists").toBeDefined();
  const persistentMod = (await mods.persistent["./persistent.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { installTestRelay } = (await mods.relay["../features/session/test-relay.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  const { RoomLobbyPage } = (await mods.lobby["../features/room/RoomLobbyPage.tsx"]!())!;
  const { roomControllerFor } = (await mods.controller["../features/session/controller.ts"]!())!;

  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  relay.peer(ID, "5151", "Avi Owner");
  const getUserMedia = vi.fn(async () => {
    throw new Error("getUserMedia must not be called by these tests");
  });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

  const fake = createFakeHost({ url, viewer: { id: 4242, name: "Test Learner" } });
  const engine = createFakeEngine({ canShareScreen: opts.canShareScreen ?? true });
  const loadEngine = vi.fn(async () => engine);
  const api = {
    getRoom: vi.fn(async () => ({ kind: "member" as const, room: room(opts.available ?? true) })),
    join: vi.fn(async () => ({ kind: "joined" as const, room: room(opts.available ?? true) })),
    getCallToken: vi.fn(async () => ({
      kind: "ok" as const,
      url: "wss://livekit.test",
      token: "call-token",
      expiresAt: "2026-11-24T00:10:00Z",
    })),
  };
  const rooms = roomControllerFor(fake.host);
  teardown.push(() => rooms.dispose());
  const calls = callMod!.callControllerFor(fake.host, { api, loadEngine });
  teardown.push(() => calls.dispose());

  const wrap = (child: ReturnType<typeof createElement>) =>
    createElement(HostContext.Provider, { value: fake.host }, createElement(RoomsApiContext.Provider, { value: api }, child));
  const persistent = await render(wrap(createElement(persistentMod.PersistentView, { host: fake.host })));
  teardown.push(persistent.unmount);
  const lobby = async () => {
    const v = await render(wrap(createElement(RoomLobbyPage, { roomId: ID })));
    teardown.push(v.unmount);
    return v;
  };
  const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
  const press = async (sel: string) => {
    const el = $(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => (el as HTMLElement).click());
  };
  const choose = async (sel: string, value: string) => {
    const el = $<HTMLSelectElement>(sel)!;
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return { fake, engine, loadEngine, api, calls, rooms, relay, getUserMedia, lobby, $, press, choose, flush };
}

describe("the call window's design (spec 047)", () => {
  // @feature SESS-069 The call window looks like a call: tiles, initials, an icon control bar, a real pre-join
  // @ac 047/AC-003
  it("pre-join: a preview area that says the camera is off, icon toggles with names, Join as the primary button", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    const icons = await import.meta.glob("../features/av/icons.tsx")["../features/av/icons.tsx"]?.();
    expect(icons, "app/src/features/av/icons.tsx exists").toBeDefined();
    await vi.waitFor(() => expect(t.$('[data-action="join-call"]')).not.toBeNull());
    await t.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="prejoin"] [data-preview-box]')).not.toBeNull());
    expect(t.$("[data-preview-box]")?.textContent).toContain("Your camera is off");
    for (const action of ["toggle-mic", "toggle-camera"]) {
      const b = t.$(`[data-action="${action}"]`)!;
      expect(b.querySelector("svg"), `${action} has an icon`).not.toBeNull();
      expect(b.textContent?.trim()).toBe(action === "toggle-mic" ? "Microphone" : "Camera");
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    expect(t.$('[data-action="join-now"]')?.className).toMatch(/primary/);
  });

  // @feature SESS-069 The call window looks like a call: tiles, initials, an icon control bar, a real pre-join
  // @ac 047/AC-001
  // @ac 047/AC-002
  it("in the call: initials for a camera that is off, a muted mark, and an icon control bar with a red Leave call", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    await vi.waitFor(() => expect(t.$('[data-action="join-call"]')).not.toBeNull());
    await t.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-action="join-now"]')).not.toBeNull());
    await t.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());
    const call = t.engine.last();
    await act(async () =>
      call.setRemote([{ id: "u:6161", name: "Rivka Levi", mic: false, camera: false, screen: false, speaking: false }]),
    );
    await vi.waitFor(() => expect(t.$('[data-participant="u:6161"]')).not.toBeNull());
    const tile = t.$('[data-participant="u:6161"]')!;
    expect(tile.querySelector("[data-initials]")?.textContent).toBe("RL");
    expect(tile.querySelector("video")).toBeNull();
    expect(tile.textContent).toContain("muted");
    expect(tile.querySelector("svg"), "a muted icon").not.toBeNull();
    for (const action of ["mic", "camera"]) {
      const b = t.$(`[data-social-call="in-call"] [data-action="${action}"]`)!;
      expect(b.querySelector("svg"), `${action} has an icon`).not.toBeNull();
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    const leave = t.$('[data-social-call="in-call"] [data-action="leave-call"]')!;
    expect(leave.textContent?.trim()).toBe("Leave call");
    expect(leave.className).toMatch(/leave/);
  });
});
