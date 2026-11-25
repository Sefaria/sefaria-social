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
import type * as ReplayModule from "~/features/replay/use-replay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// App modules through import.meta.glob: on the merge base (no surface yet) the first assertion fails instead of the import.
const apiModules = import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts");
const hostModules = import.meta.glob<typeof HostContextModule>("../host/host-context.tsx");
const lobbyModules = import.meta.glob<typeof LobbyModule>("./RoomLobbyPage.tsx");
const replayModules = import.meta.glob<typeof ReplayModule>("../replay/use-replay.ts");

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

describe("room lobby: one press into the room and its call (spec 049)", () => {
  const CTX_URL = `/texts?ctx=social.room.${ROOM_ID}`;

  /** The lobby with a fake rooms API; the call controller's `enter` is replaced, so only what the lobby asks for is tested. */
  async function lobby(opts: { viewer: { id: number; name: string } | null; member: boolean; calls: boolean }) {
    const mod = await apiModules["../api/rooms-api.ts"]?.();
    expect(mod, "app/src/features/api/rooms-api.ts exists").toBeDefined();
    const { HostContext } = (await hostModules["../host/host-context.tsx"]!())!;
    const { RoomLobbyPage } = (await lobbyModules["./RoomLobbyPage.tsx"]!())!;
    const theRoom = { ...room, calls: { available: opts.calls } };
    const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: opts.viewer });
    const { callControllerFor } = await import("~/features/av/call-controller");
    const enter = vi.fn(async () => undefined);
    Object.assign(callControllerFor(fake.host), { enter });
    let member = opts.member;
    const api: RoomsApiModule.RoomsApi = {
      getRoom: vi.fn(async () => (member ? { kind: "member" as const, room: theRoom } : { kind: "missing" as const })),
      join: vi.fn(async () => {
        member = true;
        return { kind: "joined" as const, room: theRoom };
      }),
    };
    const el = await render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(mod!.RoomsApiContext.Provider, { value: api }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
      ),
    );
    return {
      el,
      fake,
      api,
      enter,
      button: (action: string) => el.querySelector<HTMLButtonElement>(`button[data-action=${action}]`),
    };
  }
  const intoRoom = (fake: ReturnType<typeof createFakeHost>) =>
    vi.waitFor(() => expect(fake.calls.navigate.at(-1)?.to).toBe(CTX_URL), { timeout: 4000 });

  // @feature ROOM-053 One Join takes an invitee into the room and its call
  // @ac 049/AC-002
  it("an invitee's one Join makes them a member, takes them into the room and into its call with both off", async () => {
    const { el, fake, api, enter, button } = await lobby({ viewer: { id: 4242, name: "Invitee" }, member: false, calls: true });
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("outsider"));
    await act(async () => button("join")!.click());
    await intoRoom(fake);
    expect(vi.mocked(api.join).mock.calls).toEqual([[ROOM_ID]]);
    expect(enter.mock.calls).toEqual([[ROOM_ID, { mic: false, camera: false }]]);
  });

  // @feature ROOM-053 One Join takes an invitee into the room and its call
  // @ac 049/AC-003
  it("carries on by itself after a signed-out Join once the viewer is signed in on the room's page", async () => {
    const { el, fake, api, enter, button } = await lobby({ viewer: null, member: false, calls: true });
    await act(async () => button("join")!.click());
    expect(fake.calls.signIn).toBe(1);
    // The reader's sign-in returns to the address it came from, which says a Join is waiting.
    const back = `/social/r/${ROOM_ID}?join=1`;
    expect(fake.url()).toBe(`/login?next=${encodeURIComponent(back)}`);
    expect(vi.mocked(api.join).mock.calls).toEqual([]);
    fake.host.navigate(back);
    await act(async () => fake.setViewer({ id: 4242, name: "Invitee" }));
    await intoRoom(fake);
    expect(vi.mocked(api.join).mock.calls).toEqual([[ROOM_ID]]);
    expect(enter.mock.calls).toEqual([[ROOM_ID, { mic: false, camera: false }]]);
    expect(el.querySelector("main")?.dataset.roomState).toBe("member");
  });

  // @feature ROOM-053 One Join takes an invitee into the room and its call
  // @ac 049/AC-004
  it("Enter the room also joins its call", async () => {
    const { el, fake, enter, button } = await lobby({ viewer: { id: 4242, name: "Member" }, member: true, calls: true });
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("member"));
    await act(async () => button("enter")!.click());
    await intoRoom(fake);
    expect(enter.mock.calls).toEqual([[ROOM_ID, { mic: false, camera: false }]]);
  });

  // @feature ROOM-053 One Join takes an invitee into the room and its call
  // @ac 049/AC-005
  it("without calls, Join still takes the invitee into the room, and no call starts", async () => {
    const { el, fake, enter, button } = await lobby({ viewer: { id: 4242, name: "Invitee" }, member: false, calls: false });
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("outsider"));
    await act(async () => button("join")!.click());
    await intoRoom(fake);
    expect(enter.mock.calls).toEqual([]);
  });
});

describe("room lobby: the room's recordings (spec 042)", () => {
  const REC = (n: number) => `9b1c2d3e-4b5a-4c6d-8e7f-00112233445${n}`;
  const rec = (n: number, patch: Record<string, unknown>) => ({
    id: REC(n),
    roomId: ROOM_ID,
    title: null,
    status: "ready",
    startedAt: "2026-11-01T12:00:00.000Z",
    durationMs: 65_000,
    mediaBytes: 10,
    mime: "video/webm",
    owner: { userId: 5151, name: "Owner" },
    canDelete: false,
    ...patch,
  });

  async function lobbyWith(recordings: ReturnType<typeof rec>[]) {
    const mod = await apiModules["../api/rooms-api.ts"]?.();
    expect(mod, "app/src/features/api/rooms-api.ts exists").toBeDefined();
    const replayMod = await replayModules["../replay/use-replay.ts"]?.();
    expect(replayMod, "app/src/features/replay/use-replay.ts exists").toBeDefined();
    const { HostContext } = (await hostModules["../host/host-context.tsx"]!())!;
    const { RoomLobbyPage } = (await lobbyModules["./RoomLobbyPage.tsx"]!())!;
    const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: { id: 4242, name: "Test Learner" } });
    const api = {
      getRoom: vi.fn(async () => ({ kind: "member" as const, room })),
      join: vi.fn(),
    } as unknown as RoomsApiModule.RoomsApi;
    const replay = {
      listRecordings: vi.fn(async () => recordings as ReturnType<typeof rec>[]),
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
          mod!.RoomsApiContext.Provider,
          { value: api },
          createElement(
            replayMod!.ReplayApiContext.Provider,
            { value: replay },
            createElement(RoomLobbyPage, { roomId: ROOM_ID }),
          ),
        ),
      ),
    );
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("member"));
    return { el, fake, replay };
  }

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("lists the room's ready recordings, newest first, with title, date and length, each linking to its page", async () => {
    const { el, fake, replay } = await lobbyWith([
      rec(1, { title: "Older shiur", startedAt: "2026-10-01T12:00:00.000Z", durationMs: 3_725_000 }),
      rec(2, { status: "recording", title: "Still recording" }),
      rec(3, { startedAt: "2026-11-01T12:00:00.000Z" }),
      rec(4, { status: "failed", title: "Failed" }),
    ]);
    expect(replay.listRecordings).toHaveBeenCalledWith(ROOM_ID);
    await vi.waitFor(() => expect(el.querySelectorAll("[data-recordings] li").length).toBe(2));
    const rows = [...el.querySelectorAll("[data-recordings] li")].map((li) => ({
      id: li.getAttribute("data-recording-id"),
      title: li.querySelector("a")?.textContent,
      href: li.querySelector("a")?.getAttribute("href"),
      date: li.querySelector("[data-recording-date]")?.textContent,
      length: li.querySelector("[data-recording-length]")?.textContent,
    }));
    expect(rows).toEqual([
      { id: REC(3), title: "Recording of Nov 1, 2026", href: `/social/rec/${REC(3)}`, date: "Nov 1, 2026", length: "1:05" },
      { id: REC(1), title: "Older shiur", href: `/social/rec/${REC(1)}`, date: "Oct 1, 2026", length: "1:02:05" },
    ]);
    await act(async () => el.querySelector<HTMLAnchorElement>("[data-recordings] li a")!.click());
    expect(fake.calls.navigate.map((n) => n.to)).toEqual([`/social/rec/${REC(3)}`]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-001
  it("shows nothing when the room has no ready recording", async () => {
    const { el, replay } = await lobbyWith([rec(2, { status: "recording" })]);
    await vi.waitFor(() => expect(replay.listRecordings).toHaveBeenCalledTimes(1));
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(el.querySelector("[data-recordings]")).toBeNull();
  });
});

describe("room lobby: recording (spec 041)", () => {
  async function lobby(data: Record<string, unknown>) {
    const mod = (await apiModules["../api/rooms-api.ts"]!())!;
    const { HostContext } = (await hostModules["../host/host-context.tsx"]!())!;
    const { RoomLobbyPage } = (await lobbyModules["./RoomLobbyPage.tsx"]!())!;
    const fake = createFakeHost({ url: `/social/r/${ROOM_ID}`, viewer: { id: 4242, name: "Test Learner" } });
    const api = {
      getRoom: vi.fn(async () => ({ kind: "member" as const, room: { ...room, ...data } })),
      join: vi.fn(),
    } as unknown as RoomsApiModule.RoomsApi;
    const el = await render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(mod.RoomsApiContext.Provider, { value: api }, createElement(RoomLobbyPage, { roomId: ROOM_ID })),
      ),
    );
    await vi.waitFor(() => expect(el.querySelector("main")?.dataset.roomState).toBe("member"));
    return el;
  }

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-006
  it("says Recording while the room read says a recording runs, and nothing once it stops", async () => {
    const recorded = await lobby({ recording: true });
    expect(recorded.querySelector("[data-room-recording]")?.textContent).toBe("Recording");
    expect(recorded.querySelector("[data-room-recording]")?.getAttribute("role")).toBe("status");
    cleanup?.();
    cleanup = null;
    const stopped = await lobby({});
    expect(stopped.querySelector("[data-room-recording]")).toBeNull();
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-007
  it("offers Record to the room's owner only", async () => {
    const owner = await lobby({ role: "owner", ownerUserId: 4242 });
    expect(owner.querySelector<HTMLButtonElement>("button[data-action=record]")?.textContent).toBe("Record");
    cleanup?.();
    cleanup = null;
    const member = await lobby({});
    expect(member.querySelector("button[data-action=record]")).toBeNull();
  });
});

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
