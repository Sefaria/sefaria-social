// @vitest-environment jsdom
// Spec 013: enlarge and minimise (R9–R12) through the session machine and the host. The fake host plays the reader (its
// history, its sticky ctx, applySnapshot replacing); the test relay runs the real room. App modules load through
// import.meta.glob so that, on a base without them, the first assertion fails.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "~/features/session/controller";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type * as PersistentModule from "./persistent";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("../features/session/controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("../features/session/test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../features/session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../features/host/host-context.tsx"),
  persistent: import.meta.glob<typeof PersistentModule>("./persistent.tsx"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const CTX = `ctx=social.room.${ID}`;
const scroll = (seg: number) => ({ "sefaria.scroll": { v: 1, value: { seg } } });
const SETTINGS = { "sefaria.settings": { v: 1, value: { fontSize: 22 } } };

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

async function setup(url: string) {
  const controllerMod = await mods.controller["../features/session/controller.ts"]?.();
  expect(controllerMod, "app/src/features/session/controller.ts exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["../features/session/test-relay.ts"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  // The leader joined first (so holds the spotlight) and is reading Genesis 3.
  const leader = relay.peer(ID, "5151", "Leader");
  let seq = 0;
  const publish = (path: string, seg: number) =>
    leader.send({
      ch: "state",
      body:
        seq === 0
          ? { type: "keyframe", seq: seq++, t: 0, snapshot: { v: 1, url: path, nav: null, slices: scroll(seg) } }
          : { type: "change", seq: seq++, t: seq, change: { url: path, slices: scroll(seg) } },
    });
  publish("/Genesis.3", 1);
  const fake = createFakeHost({
    url,
    viewer: { id: 4242, name: "Test Learner" },
    slices: { ...SETTINGS, ...scroll(9) },
    sliceScopes: { "sefaria.settings": "personal" },
  });
  const controller = controllerMod!.roomControllerFor(fake.host);
  teardown.push(() => controller.dispose());
  return { relay, leader, publish, fake, controller };
}

describe("enlarge and minimise", () => {
  // @feature SESS-013 Enlarge into a room's reader context
  // @ac 013/AC-001
  it("from the lobby: no own place, pushes the leader's place with ctx, then applies it with origin follow once ctx is in", async () => {
    const { fake, controller } = await setup(`/social/r/${ID}`);
    await controller.enlarge(ID);
    expect(fake.calls.navigate).toEqual([{ to: `/Genesis.3?${CTX}`, replace: false, state: undefined }]);
    await vi.waitFor(() => expect(fake.calls.applied.at(-1)?.snapshot.url).toBe("/Genesis.3"));
    expect(fake.calls.applied.at(-1)?.ctx).toEqual({ origin: "follow", persist: false });
    expect(controller.view()).toEqual({
      kind: "expanded",
      context: { kind: "room", id: ID },
      ownPlace: null,
      following: true,
    });
    expect(fake.url()).toBe(`/Genesis.3?${CTX}`);
  });

  // @feature SESS-013 Enlarge into a room's reader context
  // @ac 013/AC-001
  it("from a reader page: keeps the viewer's own place before entering", async () => {
    const { controller } = await setup("/Exodus.2");
    await controller.enlarge(ID);
    const view = controller.view();
    expect(view.kind === "expanded" ? view.ownPlace?.url : null).toBe("/Exodus.2");
  });

  // @feature SESS-013 Enlarge into a room's reader context
  // @ac 013/AC-002
  it("streamed moves replace (one history entry per enlarge); Back leaves the context and nothing more is applied", async () => {
    const { fake, controller, publish } = await setup(`/social/r/${ID}`);
    await controller.enlarge(ID);
    await vi.waitFor(() => expect(fake.calls.applied).toHaveLength(1));
    publish("/Genesis.4", 2);
    publish("/Genesis.5", 3);
    publish("/Genesis.6", 4);
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.6?${CTX}`));
    expect(fake.calls.navigate.map((n) => [n.to, n.replace])).toEqual([[`/Genesis.3?${CTX}`, false]]);
    fake.back();
    expect([fake.url(), controller.view().kind]).toEqual([`/social/r/${ID}`, "idle"]);
    const applied = fake.calls.applied.length;
    publish("/Genesis.7", 5);
    await new Promise((r) => setTimeout(r, 50));
    expect([fake.calls.applied.length, fake.url()]).toEqual([applied, `/social/r/${ID}`]);
  });

  // @feature SESS-046 Minimise to the own place or the lobby
  // @ac 013/AC-003
  it("minimising pushes the own place without ctx, restores it, keeps the connection and shows the mini view", async () => {
    const { fake, controller, relay } = await setup("/Exodus.2");
    const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
    const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
    const { render } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
    const view = await render(
      createElement(HostContext.Provider, { value: fake.host }, createElement(PersistentView, { host: fake.host })),
    );
    teardown.push(view.unmount);
    await controller.enlarge(ID);
    await vi.waitFor(() => expect(view.el.querySelector("[data-action=minimise]")).not.toBeNull());
    controller.minimise();
    expect(fake.calls.navigate.map((n) => [n.to, n.replace])).toEqual([
      [`/Genesis.3?${CTX}`, false],
      ["/Exodus.2", false],
    ]);
    await vi.waitFor(() =>
      expect(fake.calls.applied.at(-1)).toMatchObject({ snapshot: { url: "/Exodus.2" }, ctx: { origin: "external" } }),
    );
    expect([fake.url(), controller.view().kind, relay.open(ID)]).toEqual(["/Exodus.2", "idle", 1]);
    await vi.waitFor(() => expect(view.el.querySelector("[data-mini-room]")?.getAttribute("data-mini-room")).toBe(ID));
    expect([...view.el.querySelectorAll("[data-mini-room] button")].map((b) => b.textContent)).toEqual(["Enlarge", "Leave"]);
  });

  // @feature SESS-046 Minimise to the own place or the lobby
  // @ac 013/AC-003
  it("minimising after entering from the lobby returns to the lobby", async () => {
    const { fake, controller } = await setup(`/social/r/${ID}`);
    await controller.enlarge(ID);
    controller.minimise();
    expect(fake.url()).toBe(`/social/r/${ID}`);
  });

  // @feature SESS-047 Reconnect from ctx alone on a cold load
  // @ac 013/AC-004
  it("a cold load of a ctx address connects to the room from the ctx alone and follows", async () => {
    const { fake, controller, relay } = await setup(`/Psalms.1?${CTX}`);
    expect(controller.view().kind).toBe("expanded");
    await vi.waitFor(() => expect(relay.open(ID)).toBe(1));
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.3?${CTX}`));
    expect(fake.calls.applied.at(-1)?.ctx.origin).toBe("follow");
    expect(fake.calls.navigate).toEqual([]); // nothing pushed: the address already was the room
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });
});
