// @vitest-environment jsdom
// Spec 048 AC-007, the call's side: clicking another person's tile follows them in the room. The tiles are rendered with a
// fake call controller (no media), so only the click is under test.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, render } from "~/features/session/test-surface";
import type { CallController } from "./call-controller";
import type { CallParticipant } from "./media";
import { Tiles } from "./Tiles";

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

const person = (id: string, name: string, local = false): CallParticipant => ({
  id,
  name,
  local,
  mic: true,
  camera: false,
  screen: false,
  speaking: false,
});

describe("call tiles (spec 048)", () => {
  // @feature SESS-072 Follow a person by clicking them; the leader takes followers along
  // @ac 048/AC-007
  it("follows the person whose tile is clicked, and offers no such click on the viewer's own tile", async () => {
    const controller = { media: () => null, role: () => "member" } as unknown as CallController;
    const onPick = vi.fn();
    const props = { controller, participants: [person("u:4242", "Me", true), person("u:5151", "Dana")], onPick };
    const view = await render(createElement(Tiles, props));
    teardown.push(view.unmount);
    const tile = (id: string) => view.el.querySelector(`[data-participant="${id}"] button[data-action=follow-tile]`);
    expect(tile("u:5151")?.getAttribute("aria-label")).toBe("Follow Dana");
    expect(tile("u:4242")).toBeNull();
    await click(tile("u:5151"));
    expect(onPick.mock.calls).toEqual([["u:5151"]]);
  });
});
