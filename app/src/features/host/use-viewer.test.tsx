// @vitest-environment jsdom
// The real reader's viewer.get() builds a new object on every call (the contract allows it). useViewer must still settle: one
// render for an unchanged viewer, and a new value only when the viewer really changes.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { HostContext } from "./host-context";
import { useViewer, type Viewer } from "./use-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useViewer", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  it("settles when viewer.get() returns a new object each call, and updates when the viewer changes", async () => {
    const fake = createFakeHost({ viewer: { id: 4242, name: "Test Learner" } });
    const original = fake.host.viewer.get;
    const host = {
      ...fake.host,
      viewer: {
        ...fake.host.viewer,
        get: () => {
          const v = original();
          return v && { ...v };
        },
      },
    };
    const seen: Viewer[] = [];
    function Probe() {
      seen.push(useViewer());
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(createElement(HostContext.Provider, { value: host }, createElement(Probe))));
    expect(seen.length).toBeLessThan(5);
    expect(seen.at(-1)).toEqual({ id: 4242, name: "Test Learner" });
    const settled = seen.length;
    await act(async () => fake.setViewer({ id: 4242, name: "Renamed Learner" }));
    expect(seen.length).toBeGreaterThan(settled);
    expect(seen.at(-1)).toEqual({ id: 4242, name: "Renamed Learner" });
    await act(async () => root.unmount());
  });
});
