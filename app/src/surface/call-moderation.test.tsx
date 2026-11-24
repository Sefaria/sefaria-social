// @vitest-environment jsdom
// Spec 039: the owner's menu on other people's tiles, and what the muted and the removed see. The fake engine plays LiveKit
// (a host mute, a removal); the fake rooms API records moderation requests. The owner's role comes from the call token's
// metadata, as the server writes it (spec 033).
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as CallModule from "~/features/av/call-controller";
import type * as MediaModule from "~/features/av/test-media";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as ApiModule from "~/features/api/rooms-api";
import type * as PersistentModule from "./persistent";

const mods = {
  menu: import.meta.glob("../features/av/TileMenu.tsx"),
  call: import.meta.glob<typeof CallModule>("../features/av/call-controller.ts"),
  media: import.meta.glob<typeof MediaModule>("../features/av/test-media.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  api: import.meta.glob<typeof ApiModule>("../features/api/rooms-api.ts"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

/** A token whose payload carries the role in its metadata, like the server's (the signature is not checked in the browser). */
const tokenFor = (role: "owner" | "member") =>
  `h.${btoa(JSON.stringify({ metadata: JSON.stringify({ v: 1, role }) })).replace(/=+$/, "")}.s`;

async function inCall(role: "owner" | "member") {
  expect(Object.keys(mods.menu), "app/src/features/av/TileMenu.tsx exists").toEqual(["../features/av/TileMenu.tsx"]);
  const callMod = (await mods.call["../features/av/call-controller.ts"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
  const { createFakeEngine } = (await mods.media["../features/av/test-media.ts"]!())!;
  const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { RoomsApiContext } = (await mods.api["../features/api/rooms-api.ts"]!())!;
  const fake = createFakeHost({ url: "/Genesis.1", viewer: { id: 4242, name: "Test Learner" } });
  const engine = createFakeEngine();
  const api = {
    getRoom: vi.fn(),
    join: vi.fn(),
    getCallToken: vi.fn(async () => ({
      kind: "ok" as const,
      url: "wss://lk.test",
      token: tokenFor(role),
      expiresAt: "2026-11-24T00:10:00Z",
    })),
    moderate: vi.fn(async () => "ok" as const),
  };
  const left = vi.fn();
  const calls = callMod.callControllerFor(fake.host, {
    api,
    loadEngine: async () => engine,
    sessions: { acquire: () => () => undefined },
    rooms: { onLeave: () => () => undefined },
  });
  teardown.push(() => calls.dispose());
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: fake.host },
      createElement(RoomsApiContext.Provider, { value: api }, createElement(PersistentView, { host: fake.host })),
    ),
  );
  teardown.push(view.unmount);
  await act(async () => calls.open(ID));
  calls.choose({ ...calls.devices(), mic: true });
  await act(async () => calls.join());
  const call = engine.last();
  await act(async () =>
    call.setRemote([
      { id: "u:5151", name: "Avi", mic: true, camera: true, screen: true, speaking: false },
      { id: "u:6161", name: "Dana", mic: false, camera: false, screen: false, speaking: false },
    ]),
  );
  await vi.waitFor(() => expect(document.querySelector('[data-participant="u:5151"]')).not.toBeNull());
  const tile = (id: string) => document.querySelector<HTMLElement>(`[data-participant="${id}"]`)!;
  const press = async (el: Element | null) => {
    expect(el, "element is on the page").not.toBeNull();
    await act(async () => (el as HTMLElement).click());
  };
  return { fake, engine, call, calls, api, tile, press, left };
}

describe("moderating a call", () => {
  // @feature SESS-063 Owner tile menu, and what the muted and removed see
  // @ac 039/AC-006
  it("gives the owner a menu on every other tile with the actions that apply, and nobody else a menu", async () => {
    const t = await inCall("owner");
    expect(t.tile("u:4242").querySelector('[data-action="tile-menu"]'), "no menu on your own tile").toBeNull();
    await t.press(t.tile("u:5151").querySelector('[data-action="tile-menu"]'));
    const items = (id: string) => [...t.tile(id).querySelectorAll("[role=menuitem]")].map((el) => el.textContent);
    expect(items("u:5151")).toEqual(["Mute microphone", "Turn off camera", "Stop screen share", "Remove from call"]);
    await t.press(t.tile("u:6161").querySelector('[data-action="tile-menu"]'));
    expect(items("u:6161")).toEqual(["Remove from call"]);

    await t.press(t.tile("u:5151").querySelector('[data-moderate="camera"]'));
    await t.press(t.tile("u:6161").querySelector('[data-moderate="remove"]'));
    expect(t.api.moderate.mock.calls).toEqual([
      [ID, "mute", "u:5151", "camera"],
      [ID, "remove", "u:6161", undefined],
    ]);
    while (teardown.length) teardown.pop()!();

    const m = await inCall("member");
    expect(document.querySelectorAll('[data-action="tile-menu"]')).toHaveLength(0);
    expect(m.api.moderate).not.toHaveBeenCalled();
  });

  // @feature SESS-063 Owner tile menu, and what the muted and removed see
  // @ac 039/AC-007
  it("tells the muted the host muted them and lets them unmute; tells the removed they were removed, in the room still", async () => {
    const t = await inCall("member");
    await act(async () => t.call.muteByHost("microphone"));
    await vi.waitFor(() => expect(document.querySelector("[data-call-notice]")?.textContent).toBe("The host muted you"));
    const mic = document.querySelector('[data-call-window] [data-action="mic"]')!;
    expect(mic.getAttribute("aria-pressed")).toBe("false");
    await t.press(mic);
    expect(t.call.calls.mic.at(-1)).toBe(true);
    expect(document.querySelector("[data-call-notice]")).toBeNull();

    await act(async () => t.call.drop("disconnected", "removed"));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-social-call="ended"]')?.textContent).toContain("You were removed from the call"),
    );
    expect(t.calls.view()).toEqual({ kind: "ended", roomId: ID, reason: "removed" });
    expect(document.querySelector('[data-action="rejoin"]'), "no Rejoin after a removal").toBeNull();
  });
});
