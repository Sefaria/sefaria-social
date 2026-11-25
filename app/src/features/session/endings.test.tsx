// @vitest-environment jsdom
// Spec 050 AC-002, AC-003, AC-007: how a session ends. The persistent mount (room window and the closed notice) is rendered with
// the fake host as the reader and the test relay as the relay, which runs the real room. App modules load through
// import.meta.glob so that, on a base without them, the first assertion fails.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./controller";
import type * as RelayModule from "./test-relay";
import type * as SurfaceModule from "./test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as PersistentModule from "~/surface/persistent";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("./test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("./test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
  persistent: import.meta.glob<typeof PersistentModule>("../../surface/persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-0011223344ee";
const CTX = `ctx=social.room.${ID}`;
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  sessionStorage.clear();
});

/** The viewer in the room's context; `owner` makes them the room's one host (the relay's owner ticket, spec 048). */
async function inRoom(owner: boolean, kind?: "room" | "broadcast" | "recording") {
  const controllerMod = await mods.controller["./controller.ts"]?.();
  expect(controllerMod, "app/src/features/session/controller.ts exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["./test-relay.ts"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const { PersistentView } = (await mods.persistent["../../surface/persistent.tsx"]!())!;
  const { render, click } = (await mods.surface["./test-surface.tsx"]!())!;
  if (kind) sessionStorage.setItem("social.sessionKinds", JSON.stringify({ [ID]: kind }));
  const relay = installTestRelay({ owners: [owner ? "4242" : "5151"] });
  teardown.push(() => relay.restore());
  // The owner, when it is not the viewer, is in the room first; everyone else is a member.
  const leader = owner ? null : relay.peer(ID, "5151", "Owner");
  const fake = createFakeHost({ url: `/Genesis.1?${CTX}`, viewer: { id: 4242, name: "Test Learner" } });
  const controller = controllerMod!.roomControllerFor(fake.host);
  teardown.push(() => controller.dispose());
  const view = await render(
    createElement(HostContext.Provider, { value: fake.host }, createElement(PersistentView, { host: fake.host })),
  );
  teardown.push(view.unmount);
  const follower = relay.peer(ID, "6161", "Follower", { isHost: false });
  await vi.waitFor(() =>
    expect(view.el.querySelector("[data-follow-status]")?.getAttribute("data-follow-status")).toBe(owner ? "leading" : "live"),
  );
  const $ = (sel: string) => view.el.querySelector<HTMLElement>(sel);
  return { relay, fake, controller, view, follower, leader, click, $ };
}

describe("how a session ends (spec 050)", () => {
  // @feature SESS-075 Close, Finish and Leave, and the closed room
  // @ac 050/AC-002
  it("Close room ends the session for everyone: the follower is told, and the owner is out of the room with a notice", async () => {
    const { relay, fake, controller, follower, click, $ } = await inRoom(true);
    expect($("button[data-action=end-session]")?.textContent).toBe("Close room");
    await click($("button[data-action=end-session]"));
    expect($("[data-end-confirm]")?.textContent).toContain("End this session for everyone in it?");
    await click($("button[data-action=confirm-end-session]"));
    await vi.waitFor(() => expect(relay.room(ID).snapshot().ended).toBe(true));
    await vi.waitFor(() =>
      expect(follower.received).toContainEqual(
        expect.objectContaining({ body: expect.objectContaining({ type: "room", ended: true }) }),
      ),
    );
    await vi.waitFor(() => expect($("[data-room-closed]")?.textContent).toContain("The room was closed."));
    expect($(`[data-room-closed] a[href$="/social/r/${ID}"]`)).not.toBeNull();
    expect(fake.url()).not.toContain(CTX);
    expect(controller.view().kind).not.toBe("expanded");
  });

  // @feature SESS-075 Close, Finish and Leave, and the closed room
  // @ac 050/AC-003
  it("Leave takes only that participant out; the session goes on for the others", async () => {
    const { relay, fake, $, click } = await inRoom(false);
    expect($("button[data-action=end-session]")).toBeNull();
    expect($("button[data-action=leave-session]")?.textContent).toBe("Leave");
    await click($("button[data-action=leave-session]"));
    await vi.waitFor(() => expect(fake.url()).not.toContain(CTX));
    await vi.waitFor(() =>
      expect(
        relay
          .room(ID)
          .snapshot()
          .participants.map((p) => p.id)
          .sort(),
      ).toEqual(["5151", "6161"]),
    );
    expect(relay.room(ID).snapshot().ended).toBe(false);
    expect($("[data-room-closed]")).toBeNull();
  });

  // @feature SESS-075 Close, Finish and Leave, and the closed room
  // @ac 050/AC-007
  it("names the owner's ending by the session's kind, and everyone else's Leave", async () => {
    const recording = await inRoom(true, "recording");
    expect(recording.$("button[data-action=end-session]")?.textContent).toBe("Finish and save");
    while (teardown.length) teardown.pop()!();
    sessionStorage.clear();

    const broadcast = await inRoom(true, "broadcast");
    expect(broadcast.$("button[data-action=end-session]")?.textContent).toBe("End broadcast");
    while (teardown.length) teardown.pop()!();
    sessionStorage.clear();

    const room = await inRoom(true, "room");
    expect(room.$("button[data-action=end-session]")?.textContent).toBe("Close room");
  });
});
