// @vitest-environment jsdom
// Spec 045 AC-003 – AC-005: the room window. The follow bar and the mini view are rendered with the fake host as the reader, the
// test relay as the relay and a fake rooms API for the room's title. App modules load through import.meta.glob so that, on a
// base without them, the first assertion fails.
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./controller";
import type * as RelayModule from "./test-relay";
import type * as SurfaceModule from "./test-surface";
import type * as FollowBarModule from "./FollowBar";
import type * as HostContextModule from "~/features/host/host-context";
import type * as RoomsApiModule from "~/features/api/rooms-api";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("./test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("./test-surface.tsx"),
  bar: import.meta.glob<typeof FollowBarModule>("./FollowBar.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  api: import.meta.glob<typeof RoomsApiModule>("../api/rooms-api.ts"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-0011223344aa";
const CTX = `ctx=social.room.${ID}`;
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

async function windowFor(url: string, node: (m: typeof FollowBarModule) => ReactNode) {
  const controllerMod = await mods.controller["./controller.ts"]?.();
  const bar = await mods.bar["./FollowBar.tsx"]?.();
  expect(bar, "app/src/features/session/FollowBar.tsx exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["./test-relay.ts"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../api/rooms-api.ts"]!())!;
  const { render, click } = (await mods.surface["./test-surface.tsx"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const leader = relay.peer(ID, "5151", "Leader");
  leader.send({
    ch: "state",
    body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", nav: null, slices: {} } },
  });
  const fake = createFakeHost({ url, viewer: { id: 4242, name: "Test Learner" } });
  const controller = controllerMod!.roomControllerFor(fake.host);
  teardown.push(() => controller.dispose());
  const api = {
    getRoom: vi.fn(async () => ({
      kind: "member" as const,
      room: {
        id: ID,
        title: "Daf Yomi",
        ownerUserId: 5151,
        role: "member" as const,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        calls: { available: false },
      },
    })),
    join: vi.fn(),
  };
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(RoomsApiContext.Provider, { value: api }, node(bar!)),
    ),
  );
  teardown.push(view.unmount);
  return { fake, controller, view, click };
}

describe("the room window (spec 045)", () => {
  // @feature SESS-068 The room window in the reader: a card with the room, its status and who is here
  // @ac 045/AC-003
  // @feature SESS-071 The room's owner is its one leader
  // @ac 048/AC-006
  it("is a labelled card with the room's title, the status, the fitting action, the room's page, Minimise and who is here", async () => {
    const { view, controller } = await windowFor(`/Genesis.1?${CTX}`, (m) => createElement(m.FollowBar, { roomId: ID }));
    await vi.waitFor(() =>
      expect(view.el.querySelector("[data-follow-status]")?.getAttribute("data-follow-status")).toBe("live"),
    );
    await vi.waitFor(() => expect(view.el.querySelector("[data-room-window] h2")?.textContent).toBe("Daf Yomi"));
    const card = view.el.querySelector<HTMLElement>("[data-room-window=open]")!;
    expect(card.getAttribute("role")).toBe("region");
    expect(card.getAttribute("aria-label")).toBe("Room: Daf Yomi");
    expect(card.style.insetInlineStart).toBe("16px");
    expect(card.querySelector("[data-follow-line]")?.textContent).toBe("Following Leader");
    // Spec 048 AC-006: the room's owner leads; nobody else is offered Lead or a leadership mode.
    expect(card.querySelector("button[data-action=lead]")).toBeNull();
    expect(card.querySelector("[data-action=mode], select")).toBeNull();
    expect(card.querySelector(`a[href$="/social/r/${ID}"]`)?.textContent).toBe("Back to the room");
    await vi.waitFor(() => expect(controller.view().kind).toBe("expanded"));
    await vi.waitFor(() => expect(card.querySelector("button[data-action=minimise]")).not.toBeNull());
    expect(card.querySelector('[data-participant="5151"] button[data-action=follow]')).not.toBeNull();
    expect(card.textContent).toContain("2 here");
  });

  // @feature SESS-068 The room window in the reader: a card with the room, its status and who is here
  // @ac 045/AC-004
  it("folds into a pill with the title and status, expands with one press, and stays folded for the session", async () => {
    const first = await windowFor(`/Genesis.1?${CTX}`, (m) => createElement(m.FollowBar, { roomId: ID }));
    await vi.waitFor(() => expect(first.view.el.querySelector("[data-room-window] h2")?.textContent).toBe("Daf Yomi"));
    await vi.waitFor(() => expect(first.view.el.querySelector("[data-follow-line]")?.textContent).toBe("Following Leader"));
    const hide = first.view.el.querySelector("button[data-action=hide-room-window]")!;
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    await first.click(hide);
    const pill = first.view.el.querySelector("button[data-action=show-room-window]")!;
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(pill.textContent).toContain("Daf Yomi");
    expect(pill.textContent).toContain("Following Leader");
    expect(first.view.el.querySelector("[data-room-window]")?.getAttribute("data-room-window")).toBe("collapsed");
    while (teardown.length) teardown.pop()!();

    // The next page keeps it folded; one press opens it.
    const next = await windowFor(`/Genesis.2?${CTX}`, (m) => createElement(m.FollowBar, { roomId: ID }));
    expect(next.view.el.querySelector("[data-room-window]")?.getAttribute("data-room-window")).toBe("collapsed");
    await next.click(next.view.el.querySelector("button[data-action=show-room-window]"));
    expect(next.view.el.querySelector("[data-room-window]")?.getAttribute("data-room-window")).toBe("open");
  });

  // @feature SESS-068 The room window in the reader: a card with the room, its status and who is here
  // @ac 045/AC-005
  it("for a live room the viewer is not in, shows the same card with the room's title, Enlarge and Leave", async () => {
    const { view } = await windowFor("/Exodus.2", (m) => createElement(m.MiniView, { roomIds: [ID] }));
    await vi.waitFor(() => expect(view.el.querySelector(`[data-mini-room="${ID}"] h2`)?.textContent).toBe("Daf Yomi"));
    expect(view.el.querySelector("[data-room-window]")?.getAttribute("role")).toBe("region");
    expect([...view.el.querySelectorAll("[data-mini-room] button")].map((b) => b.textContent)).toEqual(["Enlarge", "Leave"]);
  });
});
