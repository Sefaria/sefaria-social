// @vitest-environment jsdom
// Spec 054 AC-003, the leader's side: the Record control in the room window offers the transcript's language before recording
// starts, remembers the choice, and starts the recording with it. Modules load through import.meta.glob so that, on a base
// without them, the first assertion fails.
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ButtonModule from "./RecordButton";
import type * as ControllerModule from "./recording-controller";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";

const mods = {
  button: import.meta.glob<typeof ButtonModule>("./RecordButton.tsx"),
  controller: import.meta.glob<typeof ControllerModule>("./recording-controller.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
};

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  localStorage.clear();
});

describe("the transcript's language (spec 054)", () => {
  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-003
  it("is chosen beside Record, remembered, and the recording starts with it", async () => {
    const button = await mods.button["./RecordButton.tsx"]?.();
    expect(button?.RecordToggle, "the Record control").toBeDefined();
    const { recordingControllerFor } = (await mods.controller["./recording-controller.ts"]!())!;
    const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
    const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
    const fake = createFakeHost({ url: "/Genesis.1", viewer: { id: 4242, name: "Leader" } });
    const controller = recordingControllerFor(fake.host);
    const start = vi.fn(async () => undefined);
    Object.assign(controller, { start });
    const view = await render(
      createElement(HostContext.Provider, { value: fake.host }, createElement(button!.RecordToggle, { roomId: "room-1" })),
    );
    teardown.push(view.unmount);
    const select = view.el.querySelector<HTMLSelectElement>("[data-transcript-language]");
    expect(select, "the language choice").not.toBeNull();
    expect([...select!.options].map((o) => o.value)).toEqual(["en", "he", "yi", "fr"]);
    expect(select!.value, "English by default (D10)").toBe("en");
    await act(async () => {
      select!.value = "he";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(localStorage.getItem("social.transcriptLanguage")).toBe("he");
    await act(async () => view.el.querySelector<HTMLButtonElement>("[data-action=record-toggle]")!.click());
    expect(start.mock.calls).toEqual([["room-1", { transcriptLanguage: "he" }]]);
  });
});
