// @vitest-environment jsdom
// The lobby's Join (spec 011 AC-006), rendered with the fake host and a fake rooms API that has the real API's methods. The
// API module is loaded through import.meta.glob, so on a base without it the first assertion fails.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as RoomsApiModule from "~/features/api/rooms-api";
import type * as HostContextModule from "~/features/host/host-context";
import type * as LobbyModule from "./RoomLobbyPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// App modules through import.meta.glob: on the merge base (no surface yet) the first assertion fails instead of the import.
const apiModules = import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts");
const hostModules = import.meta.glob<typeof HostContextModule>("../host/host-context.tsx");
const lobbyModules = import.meta.glob<typeof LobbyModule>("./RoomLobbyPage.tsx");

const ROOM_ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const room = {
  id: ROOM_ID,
  title: "דף יומי",
  ownerUserId: 5151,
  role: "member" as const,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  calls: { available: false },
};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function render(node: ReactNode) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
}

async function setup(viewer: { id: number; name: string } | null, joinAnswer: "joined" | "not-found") {
  const mod = await apiModules["../api/rooms-api.ts"]?.();
  expect(mod, "app/src/features/api/rooms-api.ts exists").toBeDefined();
  const { HostContext } = (await hostModules["../host/host-context.tsx"]!())!;
  const { RoomLobbyPage } = (await lobbyModules["./RoomLobbyPage.tsx"]!())!;
  const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer });
  const api: RoomsApiModule.RoomsApi = {
    getRoom: vi.fn(async () => ({ kind: "missing" as const })),
    join: vi.fn(async () => (joinAnswer === "joined" ? { kind: "joined" as const, room } : { kind: "not-found" as const })),
  };
  const el = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(mod!.RoomsApiContext.Provider, { value: api }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
    ),
  );
  const joinButton = () => el.querySelector<HTMLButtonElement>("button[data-action=join]");
  return { fake, api, el, joinButton };
}

describe("room lobby: who is on the call (spec 038)", () => {
  // @feature ROOM-045 N on a call in the lobby and on cards
  // @ac 038/AC-004
  it("says how many are on the call while it is live, and nothing otherwise", async () => {
    const mod = (await apiModules["../api/rooms-api.ts"]!())!;
    const { HostContext } = (await hostModules["../host/host-context.tsx"]!())!;
    const { RoomLobbyPage } = (await lobbyModules["./RoomLobbyPage.tsx"]!())!;
    for (const [call, text] of [
      [{ live: true, participants: 2 }, "2 on a call"],
      [{ live: false, participants: 0 }, null],
    ] as const) {
      const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: { id: 4242, name: "Test Learner" } });
      const api = {
        getRoom: vi.fn(async () => ({ kind: "member" as const, room })),
        join: vi.fn(),
        getStatus: vi.fn(async () => ({ live: false, ref: null, heRef: null, title: null, participants: 0, call })),
      } as unknown as RoomsApiModule.RoomsApi;
      const el = await render(
        createElement(
          HostContext.Provider,
          { value: fake.host },
          createElement(mod.RoomsApiContext.Provider, { value: api }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
        ),
      );
      await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("member"));
      if (text) await vi.waitFor(() => expect(el.querySelector("[data-call-count]")?.textContent).toBe(text));
      else {
        await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
        expect(el.querySelector("[data-call-count]")).toBeNull();
      }
      cleanup?.();
      cleanup = null;
    }
  });
});

describe("room lobby: Join", () => {
  // @feature ROOM-044 Lobby Join button
  // @ac 011/AC-006
  it("offers Join to a signed-in non-member, joins, then shows the room's title", async () => {
    const { api, el, joinButton } = await setup({ id: 4242, name: "Test Learner" }, "joined");
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("outsider"));
    expect(joinButton()?.textContent).toBe("Join");
    await act(async () => joinButton()!.click());
    await vi.waitFor(() => expect(el.querySelector("h1 bdi")?.textContent).toBe("דף יומי"));
    expect(el.querySelector("h1 bdi")?.getAttribute("dir")).toBe("auto");
    expect(vi.mocked(api.join).mock.calls).toEqual([[ROOM_ID]]);
    expect(joinButton()).toBeNull();
  });

  // @feature ROOM-044 Lobby Join button
  // @ac 011/AC-006
  it("sends a signed-out viewer to the reader's sign-in without calling the API, and says when a room does not exist", async () => {
    const out = await setup(null, "joined");
    expect(out.joinButton()?.textContent).toBe("Join");
    await act(async () => out.joinButton()!.click());
    expect(out.fake.calls.signIn).toBe(1);
    expect([vi.mocked(out.api.join).mock.calls.length, vi.mocked(out.api.getRoom).mock.calls.length]).toEqual([0, 0]);
    cleanup?.();

    const missing = await setup({ id: 4242, name: "Test Learner" }, "not-found");
    await vi.waitFor(() => expect(missing.joinButton()).not.toBeNull());
    await act(async () => missing.joinButton()!.click());
    await vi.waitFor(() =>
      expect(missing.el.querySelector("[role=alert]")?.textContent).toBe("This room does not exist, or its link is wrong."),
    );
  });
});
