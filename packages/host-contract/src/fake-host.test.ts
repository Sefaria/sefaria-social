// The fake host behaves like the reader where the surface can observe it (plan 4.6; reader seam notes).
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./fake-host")>("./fake-host.ts");
async function load() {
  const mod = await modules["./fake-host.ts"]?.();
  expect(mod, "packages/host-contract/src/fake-host.ts exists").toBeDefined();
  return mod!;
}

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
