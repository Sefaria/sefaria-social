// @vitest-environment jsdom
// Spec 034: the Join call button, the pre-join step, tiles and controls, in the lobby and the persistent mount. The fake host
// plays the reader, the test relay runs the room, a fake rooms API answers, and the fake media engine plays LiveKit. App
// modules load through import.meta.glob so that, on a base without them, the first assertion fails.
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

describe("a broadcast's call, view only (spec 043)", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("joins with the broadcast's token and no pre-join or device, shows the host's video, and offers Leave only", async () => {
    const t = await setup("/Genesis.1");
    expect(typeof t.calls.joinWith, "the call controller joins view only").toBe("function");
    const tokenSource = vi.fn(async () => ({
      kind: "ok" as const,
      url: "wss://livekit.test",
      token: "bcast-token",
      expiresAt: "2026-11-25T00:10:00Z",
    }));
    await act(async () => t.calls.joinWith(`bcast_${ID}`, { tokenSource, viewer: true }));
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());
    expect(t.calls.mode()).toBe("viewer");
    expect(t.$('[data-social-call="in-call"]')?.getAttribute("data-call-mode")).toBe("viewer");
    // no pre-join step, no device asked for, nothing published, and the room's own call token is not asked for
    expect(t.engine.calls.listDevices).toBe(0);
    expect(t.engine.calls.connects).toEqual([expect.objectContaining({ token: "bcast-token", mic: false, camera: false })]);
    expect(t.getUserMedia).not.toHaveBeenCalled();
    expect(t.api.getCallToken).not.toHaveBeenCalled();
    expect(t.relay.opened.filter((o) => o.url.includes("bcast_"))).toEqual([]);

    const call = t.engine.last();
    await act(async () =>
      call.setRemote([{ id: "u:5151", name: "Avi Host", mic: true, camera: true, screen: false, speaking: true }]),
    );
    await vi.waitFor(() => expect(t.$('[data-participant="u:5151"] video')).not.toBeNull());
    expect(t.$('[data-participant="u:4242"]')).toBeNull(); // no tile of their own
    const actions = [...document.querySelectorAll('[data-social-call="in-call"] button[data-action]')].map((b) =>
      b.getAttribute("data-action"),
    );
    expect(actions.filter((a) => ["mic", "camera", "screen", "record", "leave-call"].includes(a ?? ""))).toEqual(["leave-call"]);
    await t.press('[data-social-call="in-call"] [data-action="leave-call"]');
    expect(t.calls.view().kind).toBe("off");
    expect(call.disconnected).toBe(true);
  });
});

describe("joining a call", () => {
  // @feature SESS-058 Join a call with devices off, and talk
  // @ac 034/AC-002
  it("offers Join call in the lobby and the follow bar when calls are available, and nowhere when they are not", async () => {
    const on = await setup(`/Genesis.1?${CTX}`, { available: true });
    await on.lobby();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-action="join-call"]')).toHaveLength(2));
    expect(on.$('[data-social-page="room"] [data-action="join-call"]')?.textContent).toBe("Join call");
    expect(on.$('[data-social-persistent="room"] [data-action="join-call"]')).not.toBeNull();
    while (teardown.length) teardown.pop()!();

    const off = await setup(`/Genesis.1?${CTX}`, { available: false });
    await off.lobby();
    await vi.waitFor(() => expect(off.$('[data-room-state="member"]')).not.toBeNull());
    await off.flush();
    expect(document.querySelectorAll('[data-action="join-call"]')).toHaveLength(0);
  });

  // @feature SESS-059 Calls load on demand and survive reading
  // @ac 034/AC-003
  it("loads no media code, opens no connection and asks for no device before Join call", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    await t.lobby();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-action="join-call"]')).toHaveLength(2));
    await t.flush();
    expect(t.loadEngine).not.toHaveBeenCalled();
    expect(t.engine.calls.connects).toHaveLength(0);
    expect(t.api.getCallToken).not.toHaveBeenCalled();
    expect(t.getUserMedia).not.toHaveBeenCalled();
    expect(t.$("[data-social-call]")).toBeNull();

    await t.press('[data-social-page="room"] [data-action="join-call"]');
    expect(t.loadEngine).toHaveBeenCalledTimes(1);
  });

  // @feature SESS-058 Join a call with devices off, and talk
  // @ac 034/AC-004
  it("opens a pre-join step with everything off, device choices and a preview, and joins with exactly those choices", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    await vi.waitFor(() => expect(t.$('[data-action="join-call"]')).not.toBeNull());
    await t.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="prejoin"] select[data-device="video"]')).not.toBeNull());
    expect(t.$('[data-action="toggle-mic"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(t.$('[data-action="toggle-camera"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(t.$("video[data-preview]")).toBeNull();
    expect([...t.$<HTMLSelectElement>('select[data-device="video"]')!.options].map((o) => o.textContent)).toEqual([
      "Built-in camera",
      "USB camera",
    ]);

    await t.choose('select[data-device="video"]', "cam-2");
    await t.press('[data-action="toggle-camera"]');
    await vi.waitFor(() => expect(t.$("video[data-preview]")).not.toBeNull());
    expect(t.engine.calls.previews).toEqual(["cam-2"]);
    expect(t.$('[data-action="toggle-camera"]')?.getAttribute("aria-pressed")).toBe("true");

    await t.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());
    expect(t.engine.calls.connects).toEqual([
      expect.objectContaining({ mic: false, camera: true, videoDeviceId: "cam-2", audioDeviceId: null, token: "call-token" }),
    ]);
    expect(t.engine.calls.previewsStopped).toBe(1);
  });

  // @feature SESS-058 Join a call with devices off, and talk
  // @ac 034/AC-005
  it("explains a denied camera or microphone, still lets the viewer join to listen, and leaves the room as it was", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    t.engine.denyDevices(true);
    await vi.waitFor(() => expect(t.$('[data-action="join-call"]')).not.toBeNull());
    await vi.waitFor(() => expect(t.relay.open(ID)).toBe(1));
    const before = t.relay.open(ID);
    await t.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="prejoin"]')).not.toBeNull());
    await t.press('[data-action="toggle-camera"]');
    await vi.waitFor(() => expect(t.$('[data-permission="denied"]')).not.toBeNull());
    expect(t.$('[data-permission="denied"]')?.getAttribute("role")).toBe("alert");
    expect(t.$('[data-permission="denied"]')?.textContent).toContain("site settings");
    expect(t.$('[data-action="toggle-camera"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(t.$('[data-action="join-now"]')?.textContent).toBe("Join to listen");

    await t.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());
    expect(t.engine.calls.connects[0]).toMatchObject({ mic: false, camera: false });
    expect(t.$('[data-social-persistent="room"]'), "still in the room").not.toBeNull();
    expect(t.relay.open(ID)).toBe(before);
  });

  // @feature SESS-058 Join a call with devices off, and talk
  // @ac 034/AC-006
  it("shows the others' video, and turns the microphone, camera and screen share on and off", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    await vi.waitFor(() => expect(t.$('[data-action="join-call"]')).not.toBeNull());
    await t.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-action="join-now"]')).not.toBeNull());
    await t.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());
    const call = t.engine.last();
    await act(async () =>
      call.setRemote([
        { id: "u:5151", name: "Avi Owner", mic: true, camera: true, screen: false, speaking: true },
        { id: "u:6161", name: "רבקה", mic: false, camera: false, screen: true, speaking: false },
        { id: "u:7171", name: "Late Video", mic: true, camera: true, screen: false, speaking: false, pending: true },
      ]),
    );
    // a camera that is on before its track arrives is attached when the track arrives
    expect(call.attached.some((a) => a.participantId === "u:7171")).toBe(false);
    await act(async () => call.release("u:7171"));
    await vi.waitFor(() => expect(call.attached).toContainEqual({ participantId: "u:7171", source: "camera" }));
    await vi.waitFor(() => expect(t.$('[data-participant="u:5151"] video')).not.toBeNull());
    expect(call.attached).toEqual(
      expect.arrayContaining([
        { participantId: "u:5151", source: "camera" },
        { participantId: "u:6161", source: "screen" },
      ]),
    );
    expect(t.$('[data-participant="u:5151"]')?.getAttribute("data-speaking")).toBe("true");
    expect(t.$('[data-participant="u:6161"]')?.textContent).toContain("רבקה");
    expect(t.$('[data-participant="u:4242"]')?.textContent).toContain("you");

    await t.press('[data-action="mic"]');
    await t.press('[data-action="camera"]');
    await t.press('[data-action="screen"]');
    await t.flush();
    expect([call.calls.mic, call.calls.camera, call.calls.screen]).toEqual([[true], [true], [true]]);
    expect(t.$('[data-action="mic"]')?.getAttribute("aria-pressed")).toBe("true");
    await t.press('[data-action="mic"]');
    await t.flush();
    expect(call.calls.mic).toEqual([true, false]);

    // a browser without screen sharing gets no button
    while (teardown.length) teardown.pop()!();
    const noScreen = await setup(`/Genesis.1?${CTX}`, { canShareScreen: false });
    await vi.waitFor(() => expect(noScreen.$('[data-action="join-call"]')).not.toBeNull());
    await noScreen.press('[data-action="join-call"]');
    await vi.waitFor(() => expect(noScreen.$('[data-action="join-now"]')).not.toBeNull());
    await noScreen.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(noScreen.$('[data-social-call="in-call"]')).not.toBeNull());
    expect(noScreen.$('[data-action="screen"]')).toBeNull();
  });

  // @feature SESS-059 Calls load on demand and survive reading
  // @ac 034/AC-009
  it("keeps the call connected through every navigation inside the reader", async () => {
    const t = await setup(`/social/r/${ID}`);
    await t.lobby();
    await vi.waitFor(() => expect(t.$('[data-social-page="room"] [data-action="join-call"]')).not.toBeNull());
    await t.press('[data-social-page="room"] [data-action="join-call"]');
    await vi.waitFor(() => expect(t.$('[data-action="join-now"]')).not.toBeNull());
    await t.press('[data-action="join-now"]');
    await vi.waitFor(() => expect(t.$('[data-social-call="in-call"]')).not.toBeNull());

    await act(async () => t.fake.host.navigate("/Exodus.2"));
    await act(async () => void (await t.rooms.enlarge(ID)));
    await act(async () => t.fake.host.navigate(`/Leviticus.1?${CTX}`));
    await act(async () => t.rooms.minimise());
    await act(async () => t.fake.host.navigate("/social"));
    await t.flush();
    expect(t.engine.connections).toHaveLength(1);
    expect(t.engine.last().disconnected).toBe(false);
    expect(t.calls.view()).toMatchObject({ kind: "in-call", roomId: ID });
    expect(t.$('[data-social-call="in-call"]')).not.toBeNull();
  });

  // @feature SESS-059 Calls load on demand and survive reading
  // @ac 034/AC-010
  it("after a reload in the room's context offers Join call and never rejoins or asks for devices by itself", async () => {
    const t = await setup(`/Genesis.1?${CTX}`);
    await vi.waitFor(() => expect(t.$('[data-social-persistent="room"] [data-action="join-call"]')).not.toBeNull());
    await t.flush();
    expect(t.loadEngine).not.toHaveBeenCalled();
    expect(t.engine.calls.connects).toHaveLength(0);
    expect(t.getUserMedia).not.toHaveBeenCalled();
    expect(t.calls.view()).toEqual({ kind: "off" });
  });
});
