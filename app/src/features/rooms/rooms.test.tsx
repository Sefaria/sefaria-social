// @vitest-environment jsdom
// Spec 044 at component level: Start a room (AC-001), the rooms page (AC-002) and the rail's ways in (AC-007), rendered with
// the fake host and a fake rooms API that has the real API's methods. Modules load through import.meta.glob, so on a base
// without them the first assertion fails.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as RoomsApiModule from "~/features/api/rooms-api";
import type * as HostContextModule from "~/features/host/host-context";
import type * as StartModule from "./StartRoom";
import type * as PageModule from "./RoomsPage";
import type * as NoticeModule from "./notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mods = {
  api: import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  start: import.meta.glob<typeof StartModule>("./StartRoom.tsx"),
  page: import.meta.glob<typeof PageModule>("./RoomsPage.tsx"),
  notice: import.meta.glob<typeof NoticeModule>("./notice.ts"),
};

const room = (id: string, title: string, role: "owner" | "member") => ({
  id,
  title,
  ownerUserId: role === "owner" ? 7 : 8,
  role,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  calls: { available: false },
});
const A = room("6f1c2d3e-4b5a-4c6d-8e7f-00000000000a", "Daf Yomi", "owner");
const B = room("6f1c2d3e-4b5a-4c6d-8e7f-00000000000b", "Mishnah", "member");

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

async function load() {
  const api = await mods.api["../api/rooms-api.ts"]?.();
  const start = await mods.start["./StartRoom.tsx"]?.();
  const page = await mods.page["./RoomsPage.tsx"]?.();
  expect(start, "app/src/features/rooms/StartRoom.tsx exists").toBeDefined();
  expect(page, "app/src/features/rooms/RoomsPage.tsx exists").toBeDefined();
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const notice = (await mods.notice["./notice.ts"]!())!;
  return { api: api!, start: start!, page: page!, HostContext, notice };
}

function fakeApi(over: Partial<RoomsApiModule.RoomsApi> = {}): RoomsApiModule.RoomsApi {
  return {
    getRoom: vi.fn(async () => ({ kind: "missing" as const })),
    join: vi.fn(async () => ({ kind: "not-found" as const })),
    list: vi.fn(async () => [B, A]),
    create: vi.fn(async (title: string) => ({ ...A, id: "6f1c2d3e-4b5a-4c6d-8e7f-0000000000cc", title })),
    ...over,
  };
}

async function mount(
  node: ReactNode,
  api: RoomsApiModule.RoomsApi,
  viewer: { id: number; name: string } | null = { id: 7, name: "P" },
) {
  const m = await load();
  const fake = createFakeHost({ url: "/social/rooms", viewer });
  const el = await render(
    createElement(
      m.HostContext.Provider,
      { value: fake.host },
      createElement(m.api.RoomsApiContext.Provider, { value: api }, node),
    ),
  );
  return { el, fake, m };
}

const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};

describe("start a room (spec 044)", () => {
  // @feature ROOM-046 Start a room from Social and land in its lobby
  // @ac 044/AC-001
  it("asks for a name, keeps Start disabled while it is blank, creates the room and opens its lobby", async () => {
    const api = fakeApi();
    const m = await load();
    const { el, fake } = await mount(createElement(m.start.StartRoom), api);
    await click(el.querySelector("[data-action=start-room]"));
    const dialog = el.querySelector("[data-start-room-dialog]");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    const input = el.querySelector<HTMLInputElement>("[data-room-name]")!;
    expect(document.activeElement).toBe(input);
    expect(input.maxLength).toBe(120);
    const confirm = () => el.querySelector<HTMLButtonElement>("[data-action=confirm-start-room]")!;
    expect(confirm().disabled).toBe(true);
    await type(input, "   ");
    expect(confirm().disabled).toBe(true);
    await type(input, "  Daf Yomi chavruta ");
    expect(confirm().disabled).toBe(false);
    await click(confirm());
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledWith("Daf Yomi chavruta"));
    await vi.waitFor(() => expect(fake.calls.navigate.at(-1)?.to).toBe("/social/r/6f1c2d3e-4b5a-4c6d-8e7f-0000000000cc"));
    expect(el.querySelector("[data-start-room-dialog]")).toBeNull();
  });

  // @feature ROOM-046 Start a room from Social and land in its lobby
  // @ac 044/AC-001
  it("keeps the dialog open with the reason when the create fails, and Escape closes it and returns focus", async () => {
    const api = fakeApi({ create: vi.fn(async () => Promise.reject(new Error("500"))) });
    const m = await load();
    const { el, fake } = await mount(createElement(m.start.StartRoom), api);
    const opener = el.querySelector<HTMLButtonElement>("[data-action=start-room]")!;
    await click(opener);
    await type(el.querySelector<HTMLInputElement>("[data-room-name]")!, "Shiur");
    await click(el.querySelector("[data-action=confirm-start-room]"));
    await vi.waitFor(() => expect(el.querySelector("[role=alert]")?.textContent).toBe("The room could not be created."));
    expect(el.querySelector("[data-start-room-dialog]")).not.toBeNull();
    expect(fake.calls.navigate).toHaveLength(0);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector("[data-start-room-dialog]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("the rooms page (spec 044)", () => {
  // @feature ROOM-047 Your rooms at /social/rooms and Rooms in Social's navigation
  // @ac 044/AC-002
  it("lists the viewer's rooms in the API's order, each with Owner or Member and a link to its lobby", async () => {
    const api = fakeApi();
    const m = await load();
    const { el } = await mount(createElement(m.page.RoomsPage), api);
    await vi.waitFor(() => expect(el.querySelector("[data-rooms-state]")?.getAttribute("data-rooms-state")).toBe("ready"));
    const rows = [...el.querySelectorAll("[data-room-row]")];
    expect(rows.map((r) => r.querySelector("a")?.textContent)).toEqual(["Mishnah", "Daf Yomi"]);
    expect(rows.map((r) => r.querySelector("[data-room-role]")?.textContent)).toEqual(["Member", "Owner"]);
    expect(rows[1]!.querySelector("a")?.getAttribute("href")).toContain(`/social/r/${A.id}`);
    expect(el.querySelector("[data-action=start-room]")).not.toBeNull();
  });

  // @feature ROOM-047 Your rooms at /social/rooms and Rooms in Social's navigation
  // @ac 044/AC-002
  it("says so when there are no rooms, asks a signed-out visitor to sign in, and shows a notice once", async () => {
    const m = await load();
    m.notice.setRoomsNotice("“Daf Yomi” was deleted.");
    const empty = await mount(createElement(m.page.RoomsPage), fakeApi({ list: vi.fn(async () => []) }));
    await vi.waitFor(() =>
      expect(empty.el.querySelector("[data-rooms-empty]")?.textContent).toContain("You are not in any room yet."),
    );
    expect(empty.el.querySelector("[data-rooms-notice]")?.textContent).toBe("“Daf Yomi” was deleted.");
    expect(m.notice.takeRoomsNotice()).toBeNull();
    cleanup?.();
    cleanup = null;

    const api = fakeApi();
    const out = await mount(createElement(m.page.RoomsPage), api, null);
    expect(out.el.querySelector("[data-rooms-state]")?.getAttribute("data-rooms-state")).toBe("signed-out");
    expect(api.list).not.toHaveBeenCalled();
    await click(out.el.querySelector("[data-action=sign-in]"));
    expect(out.fake.calls.navigate.at(-1)?.to).toMatch(/^\/login\?next=/);
  });
});
