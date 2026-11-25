// @vitest-environment jsdom
// Spec 046: the reader may give the page mount and the persistent mount different host objects. Page-wide controllers must
// still be one per page: Join call in the lobby (page mount, host A) opens the pre-join step in the call window (persistent
// mount, host B), and a room shown in both mounts has one connection. Fake hosts as the reader, the test relay as the relay, a
// fake media engine. App modules load through import.meta.glob so that, on a base without them, the first assertion fails.
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as DocModule from "~/features/host/document-host";
import type * as CallModule from "~/features/av/call-controller";
import type * as MediaModule from "~/features/av/test-media";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SessionsModule from "~/features/session/sessions";
import type * as ControllerModule from "~/features/session/controller";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as LobbyModule from "~/features/room/RoomLobbyPage";
import type * as PersistentModule from "./persistent";

const mods = {
  doc: import.meta.glob<typeof DocModule>("../features/host/document-host.ts"),
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  relay: import.meta.glob<typeof RelayModule>("../features/session/test-relay.ts"),
  sessions: import.meta.glob<typeof SessionsModule>("../features/session/sessions.ts"),
  controller: import.meta.glob<typeof ControllerModule>("../features/session/controller.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  lobby: import.meta.glob<typeof LobbyModule>("../features/room/RoomLobbyPage.tsx"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-0011223344cc";
const room = {
  id: ID,
  title: "Daf Yomi",
  ownerUserId: 5151,
  role: "member" as const,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  calls: { available: true },
};

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

async function load() {
  const doc = await mods.doc["../features/host/document-host.ts"]?.();
  expect(doc, "app/src/features/host/document-host.ts exists").toBeDefined();
  const relayMod = (await mods.relay["../features/session/test-relay.ts"]!())!;
  const relay = relayMod.installTestRelay();
  teardown.push(() => relay.restore());
  return { doc: doc!, relay };
}

describe("one page, two mounts, two hosts (spec 046)", () => {
  // @feature HOST-009 One call and one room connection for both of the reader's mounts
  // @ac 046/AC-001
  it("Join call pressed in the lobby (host A) opens the pre-join step in the persistent mount's call window (host B)", async () => {
    const { doc, relay } = await load();
    relay.peer(ID, "5151", "Avi Owner");
    const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
    const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
    const { roomControllerFor } = (await mods.controller["../features/session/controller.ts"]!())!;
    const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
    const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
    const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
    const { RoomLobbyPage } = (await mods.lobby["../features/room/RoomLobbyPage.tsx"]!())!;
    const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });

    const viewer = { id: 4242, name: "Test Learner" };
    const a = createFakeHost({ url: `/social/r/${ID}`, viewer });
    const b = createFakeHost({ url: `/social/r/${ID}`, viewer });
    doc.registerMountHost(a.host, "page");
    doc.registerMountHost(b.host, "persistent");
    const api = {
      getRoom: vi.fn(async () => ({ kind: "member" as const, room })),
      join: vi.fn(async () => ({ kind: "joined" as const, room })),
      getCallToken: vi.fn(async () => ({
        kind: "ok" as const,
        url: "wss://livekit.test",
        token: "t",
        expiresAt: "2026-11-25T00:10:00Z",
      })),
    };
    const engine = createFakeEngine({ canShareScreen: false });
    const rooms = roomControllerFor(a.host);
    teardown.push(() => rooms.dispose());
    const calls = callMod.callControllerFor(a.host, { api, loadEngine: vi.fn(async () => engine) });
    teardown.push(() => calls.dispose());
    expect(callMod.callControllerFor(b.host), "one call controller for both hosts").toBe(calls);

    const wrap = (host: typeof a.host, node: ReactNode) =>
      createElement(HostContext.Provider, { value: host }, createElement(RoomsApiContext.Provider, { value: api }, node));
    const persistent = await render(wrap(b.host, createElement(PersistentView, { host: b.host })));
    teardown.push(persistent.unmount);
    const lobby = await render(wrap(a.host, createElement(RoomLobbyPage, { roomId: ID })));
    teardown.push(lobby.unmount);

    await vi.waitFor(() => expect(lobby.el.querySelector("[data-action=join-call]")).not.toBeNull());
    await act(async () => lobby.el.querySelector<HTMLButtonElement>("[data-action=join-call]")!.click());
    await vi.waitFor(() => expect(persistent.el.querySelector('[data-social-call="prejoin"]')).not.toBeNull());
  });

  // @feature HOST-009 One call and one room connection for both of the reader's mounts
  // @ac 046/AC-002
  it("a room held by both mounts has one connection", async () => {
    const { doc, relay } = await load();
    const sessionsMod = (await mods.sessions["../features/session/sessions.ts"]!())!;
    const viewer = { id: 4242, name: "Test Learner" };
    const a = createFakeHost({ url: `/social/r/${ID}`, viewer });
    const b = createFakeHost({ url: `/Genesis.1?ctx=social.room.${ID}`, viewer });
    doc.registerMountHost(a.host, "page");
    doc.registerMountHost(b.host, "persistent");
    const releaseA = sessionsMod.roomSessionsFor(a.host).acquire(ID, "lobby");
    const releaseB = sessionsMod.roomSessionsFor(b.host).acquire(ID, "context");
    teardown.push(releaseA, releaseB);
    await vi.waitFor(() => expect(relay.open(ID)).toBe(1));
    expect(relay.opened.filter((o) => o.url.includes(ID))).toHaveLength(1);
  });
});
