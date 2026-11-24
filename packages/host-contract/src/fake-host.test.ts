// The fake host behaves like the reader where the surface can observe it (plan 4.6; reader seam notes).
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./fake-host")>("./fake-host.ts");
async function load() {
  const mod = await modules["./fake-host.ts"]?.();
  expect(mod, "packages/host-contract/src/fake-host.ts exists").toBeDefined();
  return mod!;
}

describe("fake host: chrome insets (spec 036)", () => {
  // @feature HOST-008 SurfaceHost 1.2 chrome insets for the call window
  // @ac 036/AC-005
  it("offers ui.chrome with insets a test can set, and builds a 1.1 host without it", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({ chrome: { top: 60, inlineStart: 0, inlineEnd: 0, bottom: 0 } } as never) as ReturnType<
      typeof createFakeHost
    > & { setChrome?(v: unknown): void };
    const chrome = (fake.host.ui as { chrome?: { get(): unknown; subscribe(cb: () => void): () => void } }).chrome;
    expect(chrome, "fake host has ui.chrome").toBeDefined();
    expect(chrome!.get()).toEqual({ top: 60, inlineStart: 0, inlineEnd: 0, bottom: 0 });
    let heard = 0;
    chrome!.subscribe(() => heard++);
    fake.setChrome!({ top: 60, inlineStart: 0, inlineEnd: 420, bottom: 0 });
    expect([heard, chrome!.get()]).toEqual([1, { top: 60, inlineStart: 0, inlineEnd: 420, bottom: 0 }]);
    const old = createFakeHost({ chromeSupported: false } as never);
    expect((old.host.ui as { chrome?: unknown }).chrome).toBeUndefined();
    expect(old.host.contract.minor).toBeLessThan(2);
  });
});

describe("fake host: slices like the reader's", () => {
  it("filters moment slices, merges applied slices into the rest, and moves locally keeping ctx", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({
      url: "/Genesis.1?ctx=social.room.room-00001",
      slices: { "sefaria.settings": { v: 1, value: { font: 20 } }, "sefaria.scroll": { v: 1, value: { seg: 1 } } },
      sliceScopes: { "sefaria.settings": "personal" },
    });
    expect(Object.keys(fake.host.reader.state.getSnapshot({ scope: "moment" }).slices)).toEqual(["sefaria.scroll"]);
    await fake.host.reader.state.applySnapshot(
      { v: 1, url: "/Genesis.2", nav: null, slices: { "sefaria.scroll": { v: 1, value: { seg: 5 } } } },
      { origin: "follow", persist: false },
    );
    expect(fake.host.reader.state.getSnapshot().slices).toEqual({
      "sefaria.settings": { v: 1, value: { font: 20 } },
      "sefaria.scroll": { v: 1, value: { seg: 5 } },
    });
    const heard: string[] = [];
    fake.host.reader.state.subscribe((_c, s) => heard.push(`${s.url} ${Object.keys(s.slices).join(",")}`), { scope: "moment" });
    fake.localMove("/Genesis.3");
    expect([fake.url(), heard]).toEqual(["/Genesis.3?ctx=social.room.room-00001", ["/Genesis.3 sefaria.scroll"]]);
  });
});

describe("fake host", () => {
  // @feature HOST-002 Fake host for tests and the harness
  // @ac 001/AC-002
  it("keeps a browser-like history: push, replace, back, forward, and notifies after each change", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({ url: "/social" });
    const seen: string[] = [];
    fake.host.location.subscribe(() => seen.push(fake.url()));
    fake.host.navigate("/social/r/abcdefgh", { state: { mine: 1 } });
    fake.host.navigate("/social/r/abcdefgh?x=1", { replace: true, state: { mine: 2 } });
    fake.back();
    fake.forward();
    expect(seen).toEqual(["/social/r/abcdefgh", "/social/r/abcdefgh?x=1", "/social", "/social/r/abcdefgh?x=1"]);
    expect(fake.host.location.get().state).toEqual({ mine: 2 });
    expect(fake.calls.navigate.map((c) => c.replace)).toEqual([false, true]);
  });

  // @feature HOST-002 Fake host for tests and the harness
  // @ac 001/AC-002
  it("refuses and reports off-site navigation; href returns '#' for it", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({ url: "/social" });
    fake.host.navigate("https://evil.example/");
    fake.host.navigate("//evil.example/");
    expect(fake.url()).toBe("/social");
    expect(fake.calls.refused).toEqual(["https://evil.example/", "//evil.example/"]);
    expect(fake.calls.report.map((r) => r.name)).toEqual(["navigate-refused", "navigate-refused"]);
    expect([fake.host.href("/social/settings"), fake.host.href("javascript:alert(1)")]).toEqual(["/social/settings", "#"]);
  });

  // @feature HOST-002 Fake host for tests and the harness
  // @ac 001/AC-002
  it("exposes ctx like the reader: only well-formed values, subscribe fires on change, applySnapshot keeps it", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({ url: "/Genesis.1?ctx=bad value" });
    expect(fake.host.reader.context.get()).toBeNull();
    let changes = 0;
    fake.host.reader.context.subscribe(() => changes++);
    fake.host.navigate("/Genesis.1?ctx=social.room.abcdefgh");
    fake.host.navigate("/Genesis.2?ctx=social.room.abcdefgh");
    expect(fake.host.reader.context.get()).toBe("social.room.abcdefgh");
    expect(changes).toBe(1);
    await fake.host.reader.state.applySnapshot(
      { v: 1, url: "/Exodus.3", nav: null, slices: { a: { v: 1, value: 1 } } },
      { origin: "follow", persist: false },
    );
    expect(fake.url()).toBe("/Exodus.3?ctx=social.room.abcdefgh");
    expect(fake.host.reader.state.getSnapshot()).toEqual({
      v: 1,
      url: "/Exodus.3",
      nav: null,
      slices: { a: { v: 1, value: 1 } },
    });
    const refused = await fake.host.reader.state.applySnapshot(
      { v: 1, url: "https://evil.example/", nav: null, slices: {} },
      { origin: "follow", persist: false },
    );
    expect(refused.warnings.map((w) => w.code)).toEqual([103]);
  });

  // @feature HOST-002 Fake host for tests and the harness
  // @ac 001/AC-002
  it("mints a short-lived token for a signed-in viewer, rejects when signed out, and records sign-in requests", async () => {
    const { createFakeHost } = await load();
    const fake = createFakeHost({ url: "/social/s/abcdefgh" });
    await expect(fake.host.viewer.identityToken()).rejects.toMatchObject({ name: "SignedOutError" });
    fake.setViewer({ id: 7, name: "Test Learner" });
    const token = await fake.host.viewer.identityToken();
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload).toMatchObject({ sub: "7", name: "Test Learner" });
    expect(payload.exp - payload.iat).toBe(300);
    fake.host.viewer.requestSignIn();
    expect(fake.calls.signIn).toBe(1);
    expect(fake.url()).toBe(`/login?next=${encodeURIComponent("/social/s/abcdefgh")}`);
  });
});
