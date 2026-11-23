// @vitest-environment jsdom
// Spec 012: who is in the room, live, in the lobby. The fake host plays the reader; the test relay (a fake global WebSocket in
// front of the real room from @sefaria-social/session) plays the relay. App modules load through import.meta.glob so that, on
// a base without them, the first assertion fails.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as HostContextModule from "~/features/host/host-context";
import type * as RoomsApiModule from "~/features/api/rooms-api";
import type * as LobbyModule from "~/features/room/RoomLobbyPage";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SurfaceModule from "~/features/session/test-surface";

const mods = {
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  api: import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts"),
  lobby: import.meta.glob<typeof LobbyModule>("../room/RoomLobbyPage.tsx"),
  relay: import.meta.glob<typeof RelayModule>("../session/test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
};

const ROOM_ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const room = {
  id: ROOM_ID,
  title: "Daf Yomi",
  ownerUserId: 5151,
  role: "member" as const,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
};

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

async function openLobby() {
  const relayMod = await mods.relay["../session/test-relay.ts"]?.();
  expect(relayMod, "app/src/features/session/test-relay.ts exists").toBeDefined();
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../api/rooms-api.ts"]!())!;
  const { RoomLobbyPage } = (await mods.lobby["../room/RoomLobbyPage.tsx"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const relay = relayMod!.installTestRelay();
  teardown.push(() => relay.restore());
  const leader = relay.peer(ROOM_ID, "5151", "Leader");
  const follower = relay.peer(ROOM_ID, "6161", "רבקה");
  follower.send({ ch: "presence", body: { type: "status", following: "5151", away: true } });
  const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: { id: 4242, name: "Test Learner" } });
  const api = { getRoom: async () => ({ kind: "member" as const, room }), join: async () => ({ kind: "joined" as const, room }) };
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(RoomsApiContext.Provider, { value: api }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
    ),
  );
  teardown.push(view.unmount);
  const entries = () =>
    [...view.el.querySelectorAll("[data-social-presence] li")].map((li) => li.textContent?.replace(/\s+/g, " ").trim());
  return { relay, leader, follower, fake, view, entries };
}

describe("presence list", () => {
  // @feature ROOM-012 Presence list
  // @ac 012/AC-001
  it("connects with a fresh token in the subprotocols and lists who leads, who follows whom, and who is away", async () => {
    const { relay, entries } = await openLobby();
    await vi.waitFor(() =>
      expect(entries()).toEqual(["Leader · leading", "רבקה · following Leader · away", "Test Learner (you) · following Leader"]),
    );
    expect(relay.opened).toHaveLength(1);
    const [{ url, protocols }] = relay.opened as [{ url: string; protocols: string[] }];
    expect(url).toBe(`ws://localhost:8787/r/${ROOM_ID}`);
    expect(protocols[0]).toBe("sefaria-social.v1");
    expect(protocols[1]).toMatch(/^bearer\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(url).not.toContain(protocols[1]!.slice("bearer.".length));
  });

  // @feature ROOM-012 Presence list
  // @ac 012/AC-002
  it("marks the viewer as you with no follow button, and gives every name dir=auto", async () => {
    const { view } = await openLobby();
    await vi.waitFor(() => expect(view.el.querySelector("[data-self]")?.textContent).toContain("(you)"));
    expect(view.el.querySelector("[data-self] button")).toBeNull();
    const names = [...view.el.querySelectorAll("[data-social-presence] [data-name]")];
    expect(names.map((n) => n.getAttribute("dir"))).toEqual(["auto", "auto", "auto"]);
  });

  // @feature ROOM-012 Presence list
  // @ac 012/AC-003
  it("keeps the list while reconnecting, and closes the socket when nothing needs the room any more", async () => {
    const { relay, view, entries } = await openLobby();
    await vi.waitFor(() => expect(entries()).toHaveLength(3));
    relay.drop(ROOM_ID, { refuse: true });
    await vi.waitFor(() =>
      expect(view.el.querySelector("[data-social-presence] [role=status]")?.textContent).toBe("Reconnecting…"),
    );
    expect(entries()).toHaveLength(3);
    relay.allow();
    await vi.waitFor(() => expect(relay.open(ROOM_ID)).toBe(1), { timeout: 5_000 });
    await vi.waitFor(() => expect(view.el.querySelector("[data-social-presence] [role=status]")).toBeNull());
    view.unmount();
    await vi.waitFor(() => expect(relay.open(ROOM_ID)).toBe(0));
  });
});
