// @vitest-environment jsdom
// Spec 044 at component level: the lobby's role line and Invite people (AC-003), renaming (AC-004), deleting (AC-005) and
// leaving (AC-006) a room. The lobby renders with the fake host, a fake rooms API with the real API's methods, and a fake replay
// API. Modules load through import.meta.glob, so on a base without them the first assertion fails.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as RoomsApiModule from "~/features/api/rooms-api";
import type * as HostContextModule from "~/features/host/host-context";
import type * as LobbyModule from "./RoomLobbyPage";
import type * as ReplayModule from "~/features/replay/use-replay";
import type * as NoticeModule from "~/features/rooms/notice";
import type * as SettingsModule from "./RoomSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mods = {
  api: import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  lobby: import.meta.glob<typeof LobbyModule>("./RoomLobbyPage.tsx"),
  replay: import.meta.glob<typeof ReplayModule>("../replay/use-replay.ts"),
  notice: import.meta.glob<typeof NoticeModule>("../rooms/notice.ts"),
  settings: import.meta.glob<typeof SettingsModule>("./RoomSettings.tsx"),
};

const ROOM_ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const roomAs = (role: "owner" | "member") => ({
  id: ROOM_ID,
  title: "Daf Yomi",
  ownerUserId: 5151,
  role,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  calls: { available: false },
});

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

async function lobby(role: "owner" | "member", over: Partial<RoomsApiModule.RoomsApi> = {}) {
  const settings = await mods.settings["./RoomSettings.tsx"]?.();
  expect(settings, "app/src/features/room/RoomSettings.tsx exists").toBeDefined();
  const mod = (await mods.api["../api/rooms-api.ts"]!())!;
  const replayMod = (await mods.replay["../replay/use-replay.ts"]!())!;
  const notice = (await mods.notice["../rooms/notice.ts"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const { RoomLobbyPage } = (await mods.lobby["./RoomLobbyPage.tsx"]!())!;
  const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: { id: role === "owner" ? 5151 : 4242, name: "P" } });
  const api: RoomsApiModule.RoomsApi = {
    getRoom: vi.fn(async () => ({ kind: "member" as const, room: roomAs(role) })),
    join: vi.fn(),
    rename: vi.fn(async (_id: string, title: string) => ({ ...roomAs(role), title })),
    remove: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    ...over,
  } as RoomsApiModule.RoomsApi;
  const replay = {
    listRecordings: vi.fn(async () => []),
    deleteRecording: vi.fn(),
    getRecording: vi.fn(),
    getState: vi.fn(),
    getMedia: vi.fn(),
  };
  const el = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(
        mod.RoomsApiContext.Provider,
        { value: api },
        createElement(replayMod.ReplayApiContext.Provider, { value: replay }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
      ),
    ),
  );
  await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("member"));
  return { el, fake, api, notice };
}

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("the lobby's invitation and room settings (spec 044)", () => {
  // @feature ROOM-048 Invite people from a room's lobby: its link with Copy and Share
  // @ac 044/AC-003
  it("shows a member the room's full link with Copy and Share, and says whether they own the room", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { el } = await lobby("member");
    expect(el.querySelector("[data-room-role]")?.textContent).toBe("You are a member of this room");
    const link = el.querySelector<HTMLInputElement>("[data-invite] [data-room-link]")!;
    expect(link.value).toMatch(new RegExp(`^https?://[^/]+/social/r/${ROOM_ID}$`));
    expect(el.querySelector("[data-invite] [data-action=share]")).not.toBeNull();
    await click(el.querySelector("[data-action=copy-room-link]"));
    expect(writeText).toHaveBeenCalledWith(link.value);
    expect(el.querySelector("[data-action=copy-room-link]")?.textContent).toBe("Copied");
    expect(el.querySelector("[data-owner-tools]")).toBeNull();
    cleanup?.();
    cleanup = null;
    const owned = await lobby("owner");
    expect(owned.el.querySelector("[data-room-role]")?.textContent).toBe("You own this room");
    expect(owned.el.querySelector("[data-owner-tools]")).not.toBeNull();
  });

  // @feature ROOM-049 Rename or delete a room you own
  // @ac 044/AC-004
  it("lets the owner rename the room, with Save disabled for a blank name and a failure reported", async () => {
    const { el, api } = await lobby("owner");
    await click(el.querySelector("[data-action=rename-room]"));
    const input = el.querySelector<HTMLInputElement>("[data-rename-input]")!;
    await type(input, "  ");
    expect(el.querySelector<HTMLButtonElement>("[data-action=save-rename]")!.disabled).toBe(true);
    await type(input, "Mishnah Berurah");
    await click(el.querySelector("[data-action=save-rename]"));
    await vi.waitFor(() => expect(el.querySelector("h1")?.textContent).toBe("Mishnah Berurah"));
    expect(api.rename).toHaveBeenCalledWith(ROOM_ID, "Mishnah Berurah");
    expect(el.querySelector("[data-rename-form]")).toBeNull();

    vi.mocked(api.rename!).mockRejectedValueOnce(new Error("500"));
    await click(el.querySelector("[data-action=rename-room]"));
    await type(el.querySelector<HTMLInputElement>("[data-rename-input]")!, "Other");
    await click(el.querySelector("[data-action=save-rename]"));
    await vi.waitFor(() =>
      expect(el.querySelector("[data-room-settings] [role=alert]")?.textContent).toBe("The name could not be saved."),
    );
  });

  // @feature ROOM-049 Rename or delete a room you own
  // @ac 044/AC-005
  it("asks before deleting, says the recordings go too, then deletes and opens the rooms page with a notice", async () => {
    const { el, api, fake, notice } = await lobby("owner");
    expect(el.querySelector("[data-action=leave-room]")).toBeNull();
    await click(el.querySelector("[data-action=delete-room]"));
    expect(el.querySelector("[data-confirm=delete]")?.textContent).toContain(
      "Delete “Daf Yomi”? Its recordings will be deleted too, and no one will be able to open it.",
    );
    expect(api.remove).not.toHaveBeenCalled();
    await click(el.querySelector("[data-action=confirm-delete-room]"));
    await vi.waitFor(() => expect(fake.calls.navigate.at(-1)?.to).toBe("/social/rooms"));
    expect(api.remove).toHaveBeenCalledWith(ROOM_ID);
    expect(notice.takeRoomsNotice()).toBe("“Daf Yomi” was deleted.");
  });

  // @feature ROOM-050 Leave a room you joined
  // @ac 044/AC-006
  it("asks a member before leaving, then leaves and opens the rooms page with a notice; Cancel keeps them in", async () => {
    const { el, api, fake, notice } = await lobby("member");
    expect(el.querySelector("[data-action=delete-room]")).toBeNull();
    expect(el.querySelector("[data-action=rename-room]")).toBeNull();
    await click(el.querySelector("[data-action=leave-room]"));
    expect(el.querySelector("[data-confirm=leave]")?.textContent).toContain("Leave “Daf Yomi”? You can come back with its link.");
    await click(el.querySelector("[data-action=cancel-confirm]"));
    expect(el.querySelector("[data-confirm]")).toBeNull();
    await click(el.querySelector("[data-action=leave-room]"));
    await click(el.querySelector("[data-action=confirm-leave-room]"));
    await vi.waitFor(() => expect(fake.calls.navigate.at(-1)?.to).toBe("/social/rooms"));
    expect(api.leave).toHaveBeenCalledWith(ROOM_ID);
    expect(notice.takeRoomsNotice()).toBe("You left “Daf Yomi”.");
  });
});
