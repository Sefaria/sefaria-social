// @vitest-environment jsdom
// The lobby's broadcast panel (spec 043 AC-006), rendered in the real lobby with the fake host, a fake rooms API, the test relay
// for the broadcast's room, a fake broadcast API and a fake call controller. App modules load through import.meta.glob so
// that, on a base without them, the first assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as PanelModule from "./BroadcastPanel";
import type * as ControllerModule from "./broadcast-controller";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as LobbyModule from "~/features/room/RoomLobbyPage";
import type { CallView } from "~/features/av/machine";

const mods = {
  panel: import.meta.glob<typeof PanelModule>("./BroadcastPanel.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("./broadcast-controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("../session/test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../api/rooms-api.ts"),
  lobby: import.meta.glob<typeof LobbyModule>("../room/RoomLobbyPage.tsx"),
};

const ROOM = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const BID = "0b1c2d3e-4f5a-4b6c-8d7e-00112233aabb";
const room = (role: "owner" | "member") => ({
  id: ROOM,
  title: "Daf Yomi",
  ownerUserId: 4242,
  role,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  calls: { available: true },
});

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
});

async function setup(role: "owner" | "member") {
  const panelMod = await mods.panel["./BroadcastPanel.tsx"]?.();
  expect(panelMod, "app/src/features/broadcast/BroadcastPanel.tsx exists").toBeDefined();
  const { broadcastControllerFor } = (await mods.controller["./broadcast-controller.ts"]!())!;
  const { installTestRelay } = (await mods.relay["../session/test-relay.ts"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../api/rooms-api.ts"]!())!;
  const { RoomLobbyPage } = (await mods.lobby["../room/RoomLobbyPage.tsx"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  const fake = createFakeHost({ url: `/social/r/${ROOM}`, viewer: { id: 4242, name: "Avi Owner" } });
  const broadcast = (status: "live" | "ended") => ({
    id: BID,
    roomId: ROOM,
    title: "Daf Yomi",
    hostName: "Avi Owner",
    status,
    startedAt: "2026-11-25T08:00:00.000Z",
    link: `/social/b/${BID}`,
  });
  const api = {
    start: vi.fn(async (_roomId: string) => ({ kind: "ok" as const, broadcast: broadcast("live") })),
    end: vi.fn(async (_id: string) => undefined),
    get: vi.fn(async (_id: string) => ({ kind: "ok" as const, broadcast: broadcast("live") })),
    ticket: vi.fn(async (_id: string) => ({
      kind: "ok" as const,
      ticket: {
        ticket: "tkt-host",
        role: "host" as const,
        relayRoom: `b_${BID}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    })),
    callToken: vi.fn(async (_id: string) => ({ kind: "not-found" as const })),
  };
  let view: CallView = { kind: "off" };
  const calls = {
    view: () => view,
    open: vi.fn(async (key: string) => {
      view = {
        kind: "prejoin",
        roomId: key,
        devices: { mic: false, camera: false, audioDeviceId: null, videoDeviceId: null, permission: "unknown" },
      };
    }),
    joinWith: vi.fn(async () => undefined),
    leave: vi.fn(async () => {
      view = { kind: "off" };
    }),
    dismiss: vi.fn(),
  };
  const controller = broadcastControllerFor(fake.host, { api, calls, windowOwner: { request: async () => true } });
  teardown.push(() => controller.dispose());
  const rooms = {
    getRoom: vi.fn(async () => ({ kind: "member" as const, room: room(role) })),
    join: vi.fn(async () => ({ kind: "joined" as const, room: room(role) })),
  };
  const view$ = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(RoomsApiContext.Provider, { value: rooms }, createElement(RoomLobbyPage, { roomId: ROOM })),
    ),
  );
  teardown.push(view$.unmount);
  const $ = (sel: string) => view$.el.querySelector<HTMLElement>(sel);
  const press = async (sel: string) => {
    const el = $(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
  };
  return { fake, api, calls, controller, relay, writeText, $, press };
}

describe("broadcast panel", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-006
  it("lets the owner broadcast: the link with Copy, the reader published to the broadcast room, Join the broadcast call, End", async () => {
    const { $, press, api, calls, relay, writeText, controller } = await setup("owner");
    await vi.waitFor(() => expect($('[data-action="broadcast"]')?.textContent).toBe("Broadcast"));
    await press('[data-action="broadcast"]');
    await vi.waitFor(() => expect($('[data-broadcast="live"]')).not.toBeNull());
    expect(api.start).toHaveBeenCalledWith(ROOM);
    const link = $("[data-broadcast-link]") as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/social/b/${BID}`);
    await press('[data-action="copy-broadcast-link"]');
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/social/b/${BID}`);
    expect($('[data-action="copy-broadcast-link"]')?.textContent).toBe("Copied");

    // The owner's reader is published to the broadcast's relay room, as its host, with the ticket.
    await vi.waitFor(() => expect(relay.room(`b_${BID}`).snapshot().spotlight).toBe("4242"));
    expect(relay.opened.find((o) => o.url.endsWith(`/r/b_${BID}`))?.protocols).toContain("ticket.tkt-host");

    await press('[data-action="join-broadcast-call"]');
    expect(calls.open).toHaveBeenCalledWith(`bcast_${BID}`, expect.objectContaining({ tokenSource: expect.any(Function) }));

    await press('[data-action="end-broadcast"]');
    await vi.waitFor(() => expect($('[data-broadcast="idle"] [data-action="broadcast"]')).not.toBeNull());
    expect(api.end).toHaveBeenCalledWith(BID);
    expect(calls.leave).toHaveBeenCalledTimes(1);
    expect(relay.room(`b_${BID}`).snapshot().ended).toBe(true);
    expect(controller.hostView()).toEqual({ kind: "idle" });
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-006
  it("is not offered to a member who is not the room's owner", async () => {
    const { $ } = await setup("member");
    await vi.waitFor(() => expect($('[data-action="enter"]')).not.toBeNull());
    expect($('[data-action="broadcast"]')).toBeNull();
  });
});
