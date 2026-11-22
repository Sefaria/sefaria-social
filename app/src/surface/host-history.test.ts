// Unit tests for the host-bridged history (R4). They pin the behaviour of TanStack's createHistory that the surface relies on,
// which is not in the public docs (docs/decisions/0003-two-builds.md).
import { describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";

const modules = import.meta.glob<typeof import("./host-history")>("./host-history.ts");
async function load() {
  const mod = await modules["./host-history.ts"]!();
  expect(mod, "host-history.ts exports createHostHistory").toHaveProperty("createHostHistory");
  return mod;
}

describe("createHostHistory", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-002
  it("reads the host's location, pushes and replaces through host.navigate, and builds hrefs with host.href", async () => {
    const { createHostHistory } = await load();
    const fake = createFakeHost({ url: "/social?x=1#h" });
    const history = createHostHistory(fake.host);
    expect([history.location.pathname, history.location.search, history.location.hash]).toEqual(["/social", "?x=1", "#h"]);
    history.push("/social/settings");
    history.replace("/social/settings?tab=profile");
    expect(fake.calls.navigate.map((c) => [c.to, c.replace])).toEqual([
      ["/social/settings", false],
      ["/social/settings?tab=profile", true],
    ]);
    expect(history.location.href).toBe("/social/settings?tab=profile");
    expect(history.location.state.__TSR_index).toBe(1);
    expect(history.createHref("/social/r/abcdefgh")).toBe("/social/r/abcdefgh");
    expect(fake.calls.href).toEqual(["/social/r/abcdefgh"]);
  });

  it("notifies once per change: once for its own push, once for each Back or Forward the reader makes", async () => {
    const { createHostHistory } = await load();
    const fake = createFakeHost({ url: "/social" });
    const history = createHostHistory(fake.host);
    const actions: string[] = [];
    history.subscribe(({ action }) => actions.push(action.type));
    history.push("/social/settings");
    fake.back();
    fake.forward();
    expect(actions).toEqual(["PUSH", "BACK", "FORWARD"]);
    expect(history.location.pathname).toBe("/social/settings");
  });

  it("gives entries the reader created (no router state, or junk state) a stable key and index 0", async () => {
    const { readHostLocation } = await load();
    const fake = createFakeHost({ url: "/social" });
    fake.host.navigate("/social/r/abcdefgh", { state: { __TSR_index: "nope" } });
    const a = readHostLocation(fake.host);
    const b = readHostLocation(fake.host);
    expect(a.state).toEqual({ __TSR_index: 0, __TSR_key: "host:/social/r/abcdefgh", key: "host:/social/r/abcdefgh" });
    expect(b.state.__TSR_key).toBe(a.state.__TSR_key);
  });

  it("does not support programmatic go/back/forward (not in SurfaceHost v1): it reports and leaves the address alone", async () => {
    const { createHostHistory } = await load();
    const fake = createFakeHost({ url: "/social/settings" });
    const history = createHostHistory(fake.host);
    history.back();
    await vi.waitFor(() => expect(fake.calls.report.map((r) => r.name)).toEqual(["surface-history-unsupported"]));
    expect(fake.url()).toBe("/social/settings");
  });

  it("stops listening to the host when destroyed", async () => {
    const { createHostHistory } = await load();
    const fake = createFakeHost({ url: "/social" });
    const history = createHostHistory(fake.host);
    const seen = vi.fn();
    history.subscribe(seen);
    history.destroy();
    fake.host.navigate("/social/settings");
    expect(seen).not.toHaveBeenCalled();
  });
});
