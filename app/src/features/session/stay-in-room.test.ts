// @vitest-environment jsdom
// Spec 045 AC-001 and AC-002: reading around keeps the viewer in the room. The fake host plays the reader; a link in the reader is
// played as input followed by a push without ctx (the real reader's links drop it). The test relay runs the real room. App
// modules load through import.meta.glob so that, on a base without them, the first assertion fails.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./controller";
import type * as RelayModule from "./test-relay";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("./test-relay.ts"),
};

const ID = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const OTHER = "6f1c2d3e-4b5a-4c6d-8e7f-0011223344ff";
const CTX = `ctx=social.room.${ID}`;
const scroll = (seg: number) => ({ "sefaria.scroll": { v: 1, value: { seg } } });

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

async function setup(url: string) {
  const mod = await mods.controller["./controller.ts"]?.();
  expect(mod, "app/src/features/session/controller.ts exists").toBeDefined();
  const { installTestRelay } = (await mods.relay["./test-relay.ts"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const leader = relay.peer(ID, "5151", "Leader");
  leader.send({
    ch: "state",
    body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.3", nav: null, slices: scroll(1) } },
  });
  const fake = createFakeHost({ url, viewer: { id: 4242, name: "Test Learner" }, slices: scroll(9) });
  const controller = mod!.roomControllerFor(fake.host);
  teardown.push(() => controller.dispose());
  /** A link in the reader: input, then a push to a reader page without any ctx. */
  const link = (to: string) => {
    fake.localInput();
    fake.host.navigate(to);
  };
  return { fake, controller, link, leader };
}

describe("staying in the room while reading around (spec 045)", () => {
  // @feature SESS-067 Stay in the room while reading around the reader
  // @ac 045/AC-001
  it("a link to another reader page keeps the room's ctx (replacing the entry) and the viewer stays in the room", async () => {
    const { fake, controller, link } = await setup(`/social/r/${ID}`);
    await controller.enlarge(ID);
    await vi.waitFor(() => expect(controller.view().kind).toBe("expanded"));
    link("/texts/Tanakh");
    await vi.waitFor(() => expect(fake.url()).toBe(`/texts/Tanakh?${CTX}`));
    expect(fake.calls.navigate.at(-1)).toMatchObject({ to: `/texts/Tanakh?${CTX}`, replace: true });
    // Reading around on their own: detached from following, still in the room's context.
    expect(controller.view()).toMatchObject({ kind: "detached", context: { kind: "room", id: ID } });
    // And again from there.
    link("/Psalms.23");
    await vi.waitFor(() => expect(fake.url()).toBe(`/Psalms.23?${CTX}`));
    expect(controller.view()).toMatchObject({ kind: "detached", context: { kind: "room", id: ID } });
  });

  // @feature SESS-067 Stay in the room while reading around the reader
  // @ac 045/AC-001
  it("Back to the page they entered from, a Social page, or another room's address still leaves", async () => {
    const fromReader = await setup("/Exodus.2");
    await fromReader.controller.enlarge(ID);
    await vi.waitFor(() => expect(fromReader.controller.view().kind).toBe("expanded"));
    fromReader.fake.back();
    await vi.waitFor(() => expect(fromReader.controller.view().kind).toBe("idle"));
    expect(fromReader.fake.url()).toBe("/Exodus.2");
    while (teardown.length) teardown.pop()!();

    const social = await setup(`/social/r/${ID}`);
    await social.controller.enlarge(ID);
    await vi.waitFor(() => expect(social.controller.view().kind).toBe("expanded"));
    social.link("/social/rooms");
    await vi.waitFor(() => expect(social.controller.view().kind).toBe("idle"));
    expect(social.fake.url()).toBe("/social/rooms");
    while (teardown.length) teardown.pop()!();

    const other = await setup(`/social/r/${ID}`);
    await other.controller.enlarge(ID);
    await vi.waitFor(() => expect(other.controller.view().kind).toBe("expanded"));
    other.link(`/Genesis.9?ctx=social.room.${OTHER}`);
    await vi.waitFor(() => expect(other.fake.url()).toBe(`/Genesis.9?ctx=social.room.${OTHER}`));
  });

  // @feature SESS-067 Stay in the room while reading around the reader
  // @ac 045/AC-002
  it("a follower who follows a link stays in the room on their own, and Follow again takes them to the leader", async () => {
    const { fake, controller, link } = await setup(`/social/r/${ID}`);
    await controller.enlarge(ID);
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.3?${CTX}`));
    link("/texts/Talmud");
    await vi.waitFor(() => expect(fake.url()).toBe(`/texts/Talmud?${CTX}`));
    expect(controller.view()).toMatchObject({ kind: "detached", context: { kind: "room", id: ID } });
    controller.followAgain();
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.3?${CTX}`));
    expect(controller.view()).toMatchObject({ kind: "expanded", context: { kind: "room", id: ID } });
  });
});
