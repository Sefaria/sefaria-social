// @vitest-environment jsdom
// Spec 014: following in a room's context through the reader state API: the spotlight by default or someone picked, breaking
// away and following again, taking the lead. Fake host as the reader, the test relay as the relay, the follow bar rendered
// in the persistent mount. App modules load through import.meta.glob so that, on a base without them, the first assertion
// fails.
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

const ID = "room-follow-0001";
const CTX = `ctx=social.room.${ID}`;
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

type Peer = ReturnType<ReturnType<typeof RelayModule.installTestRelay>["peer"]>;
function streamOf(peer: Peer) {
  let seq = 0;
  return (path: string) =>
    peer.send({
      ch: "state",
      body:
        seq === 0
          ? { type: "keyframe", seq: seq++, t: 0, snapshot: { v: 1, url: path, nav: null, slices: {} } }
          : { type: "change", seq: seq++, t: seq, change: { url: path } },
    });
}

/** A viewer already in the room's context (a ctx address), with the follow bar rendered. */
async function inRoom() {
  const controllerMod = await mods.controller["../features/session/controller.ts"]?.();
  expect(controllerMod, "app/src/features/session/controller.ts exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["../features/session/test-relay.ts"]!())!;
  const { HostContext } = (await mods.host["../features/host/host-context.tsx"]!())!;
  const { PersistentView } = (await mods.persistent["./persistent.tsx"]!())!;
  const { render, click } = (await mods.surface["../features/session/test-surface.tsx"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const leader = relay.peer(ID, "5151", "Leader");
  const other = relay.peer(ID, "6161", "Other");
  const leaderMoves = streamOf(leader);
  const otherMoves = streamOf(other);
  leaderMoves("/Genesis.1");
  otherMoves("/Exodus.1");
  const fake = createFakeHost({ url: `/Genesis.1?${CTX}`, viewer: { id: 4242, name: "Test Learner" } });
  const controller = controllerMod!.roomControllerFor(fake.host);
  teardown.push(() => controller.dispose());
  const view = await render(
    createElement(HostContext.Provider, { value: fake.host }, createElement(PersistentView, { host: fake.host })),
  );
  teardown.push(view.unmount);
  const button = (action: string, participant?: string) =>
    view.el.querySelector(`${participant ? `[data-participant="${participant}"] ` : ""}button[data-action=${action}]`);
  await vi.waitFor(() => expect(view.el.querySelector("[data-follow-status]")?.getAttribute("data-follow-status")).toBe("live"));
  return { relay, leader, other, leaderMoves, otherMoves, fake, controller, view, button, click };
}

describe("following a person by clicking them (spec 048)", () => {
  // @feature SESS-072 Follow a person by clicking them; the leader takes followers along
  // @ac 048/AC-007
  it("follows the person clicked, returns to the leader on a second click, and offers the leader Lead again", async () => {
    const { leader, button, click, view } = await inRoom();
    const line = () => view.el.querySelector("[data-follow-line]")?.textContent;
    await click(button("follow", "6161"));
    await vi.waitFor(() => expect(line()).toBe("Following Other"));
    await click(button("follow", "6161"));
    await vi.waitFor(() => expect(line()).toBe("Following Leader"));
    await click(button("follow", "6161"));
    await vi.waitFor(() => expect(line()).toBe("Following Other"));
    await click(button("follow", "5151"));
    await vi.waitFor(() => expect(line()).toBe("Following Leader"));

    // The leader hands the viewer the spotlight; the viewer follows Other, and Lead again brings them back to leading.
    leader.send({ ch: "control", body: { type: "spotlight", to: "4242" } });
    await vi.waitFor(() => expect(line()).toBe("You are leading"));
    expect(button("lead-again")).toBeNull();
    await click(button("follow", "6161"));
    await vi.waitFor(() => expect(line()).toBe("Following Other"));
    await click(button("lead-again"));
    await vi.waitFor(() => expect(line()).toBe("You are leading"));
  });
});

describe("following", () => {
  // @feature SESS-014 Follow, follow again and lead
  // @ac 014/AC-001
  it("follows the spotlight through applySnapshot with origin follow, and switches to someone picked in the presence list", async () => {
    const { fake, leaderMoves, otherMoves, view, button, click } = await inRoom();
    leaderMoves("/Genesis.4");
    await vi.waitFor(() => expect(fake.calls.applied.at(-1)?.snapshot.url).toBe("/Genesis.4"));
    expect(fake.calls.applied.every((a) => a.ctx.origin === "follow")).toBe(true);
    expect(view.el.querySelector("[data-follow-line]")?.textContent).toBe("Following Leader");

    await vi.waitFor(() => expect(button("follow", "6161")).not.toBeNull());
    await click(button("follow", "6161"));
    await vi.waitFor(() => expect(fake.url()).toBe(`/Exodus.1?${CTX}`));
    otherMoves("/Exodus.2");
    await vi.waitFor(() => expect(fake.url()).toBe(`/Exodus.2?${CTX}`));
    expect(view.el.querySelector("[data-follow-line]")?.textContent).toBe("Following Other");
    expect(fake.calls.navigate).toEqual([]); // following never pushes
  });

  // @feature SESS-014 Follow, follow again and lead
  // Spec 048 replaced 014/AC-002's "any input pauses": the viewer now has to move clearly away (proof: @ac 048/AC-001..003).
  it("stops applying when the viewer moves themselves, offers Follow again, and catches up at once when pressed", async () => {
    const { fake, leaderMoves, controller, button, click, view } = await inRoom();
    fake.localInput(); // the person goes to another book in the reader
    fake.localMove("/Exodus.20");
    await vi.waitFor(() => expect(controller.view().kind).toBe("detached"));
    const applied = fake.calls.applied.length;
    leaderMoves("/Genesis.9");
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.calls.applied.length).toBe(applied);
    expect(view.el.querySelector("[data-follow-line]")?.textContent).toBe("You are on your own");
    await click(button("follow-again"));
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.9?${CTX}`));
    expect(controller.view().kind).toBe("expanded");
  });

  // @feature SESS-014 Follow, follow again and lead
  // Spec 048 removed Lead (014/AC-003's way in): the room's owner hands the spotlight here; the moves still reach followers.
  it("once the viewer holds the spotlight, their own moves reach those who follow (without ctx)", async () => {
    const { fake, relay, leader, view } = await inRoom();
    leader.send({ ch: "control", body: { type: "spotlight", to: "4242" } });
    await vi.waitFor(() => expect(relay.room(ID).snapshot().spotlight).toBe("4242"));
    await vi.waitFor(() => expect(view.el.querySelector("[data-follow-line]")?.textContent).toBe("You are leading"));
    fake.localMove("/Leviticus.1");
    const fromViewer = () =>
      leader.received.filter(
        (m) => (m as { ch: string; from?: string }).ch === "state" && (m as { from?: string }).from === "4242",
      );
    await vi.waitFor(() => expect(JSON.stringify(fromViewer())).toContain("/Leviticus.1"));
    expect(JSON.stringify(fromViewer())).not.toContain("ctx");
  });
});
