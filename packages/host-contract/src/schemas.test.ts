// The runtime schemas guard every value that crosses the contract (plan 4.2). Loaded through import.meta.glob so each test
// fails on an assertion, not an import, where the module does not exist (prove-red).
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./schemas")>("./schemas.ts");
async function load() {
  const mod = await modules["./schemas.ts"]?.();
  expect(mod, "packages/host-contract/src/schemas.ts exists").toBeDefined();
  return mod!;
}

describe("SurfaceHost 1.2 (spec 036)", () => {
  // @feature HOST-008 SurfaceHost 1.2 chrome insets for the call window
  // @ac 036/AC-001
  it("pins contract 1.2 with an optional ui.chrome, and checks inset values at run time", async () => {
    const m = await load();
    const { SURFACE_HOST_CONTRACT } = await import("./contract");
    expect(SURFACE_HOST_CONTRACT).toEqual({ major: 1, minor: 2 });
    const insets = (m as unknown as { chromeInsetsSchema?: { safeParse(v: unknown): { success: boolean } } }).chromeInsetsSchema;
    expect(insets, "chromeInsetsSchema is exported").toBeDefined();
    expect(insets!.safeParse({ top: 60, inlineStart: 0, inlineEnd: 420, bottom: 0 }).success).toBe(true);
    for (const bad of [
      { top: -1, inlineStart: 0, inlineEnd: 0, bottom: 0 },
      { top: Infinity, inlineStart: 0, inlineEnd: 0, bottom: 0 },
      { top: 1 },
      null,
    ])
      expect(insets!.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const fn = () => undefined;
    const ui = { interfaceLang: "english", theme: "light", subscribe: fn };
    const shape = m.surfaceHostShapeSchema.shape.ui;
    expect(shape.safeParse(ui).success, "1.1 ui without chrome").toBe(true);
    expect(shape.safeParse({ ...ui, chrome: { get: fn, subscribe: fn } }).success, "1.2 ui with chrome").toBe(true);
    expect(shape.safeParse({ ...ui, chrome: { get: 1 } }).success, "a malformed chrome").toBe(false);
  });
});

describe("contract schemas", () => {
  // @feature HOST-001 Pinned SurfaceHost contract with runtime schemas
  // @ac 001/AC-001
  it("accepts a valid snapshot and refuses one that is foreign, carries ctx, or leaves the site", async () => {
    const { readerSnapshotSchema } = await load();
    const ok = { v: 1, url: "/Genesis.1.3?lang=bi", nav: { panel: "p0" }, slices: { scroll: { v: 1, value: { y: 2 } } } };
    expect(readerSnapshotSchema.safeParse(ok).success).toBe(true);
    const bad = [
      { ...ok, v: 2 },
      { ...ok, url: "/Genesis.1?ctx=social.room.abcdefgh" },
      { ...ok, url: "//evil.example/x" },
      { ...ok, url: "https://evil.example/x" },
      { ...ok, slices: { scroll: { value: 1 } } },
      "not an object",
    ];
    expect(bad.map((b) => readerSnapshotSchema.safeParse(b).success)).toEqual([false, false, false, false, false, false]);
  });

  // @feature HOST-001 Pinned SurfaceHost contract with runtime schemas
  // @ac 001/AC-001
  it("checks the host's shape and major version, the location, the viewer and the ctx grammar", async () => {
    const s = await load();
    expect(s.contractVersionSchema.safeParse({ major: 1, minor: 7 }).success).toBe(true);
    expect(s.contractVersionSchema.safeParse({ major: 2, minor: 0 }).success).toBe(false);
    expect(s.hostLocationSchema.safeParse({ pathname: "/social", search: "?a=1", hash: "", state: null }).success).toBe(true);
    expect(s.hostLocationSchema.safeParse({ pathname: "social", search: "a=1", hash: "", state: null }).success).toBe(false);
    expect(s.viewerSchema.safeParse(null).success).toBe(true);
    expect(s.viewerSchema.safeParse({ id: 0, name: "" }).success).toBe(false);
    expect(["social.room.abcdefgh", "x.y"].map((v) => s.readerContextSchema.safeParse(v).success)).toEqual([true, true]);
    expect(["Social.room.x", "social", "social.", "a.b c"].map((v) => s.readerContextSchema.safeParse(v).success)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(s.surfaceHostShapeSchema.safeParse({ contract: { major: 1, minor: 0 } }).success).toBe(false);
  });

  // @feature HOST-001 Pinned SurfaceHost contract with runtime schemas
  // @ac 001/AC-001
  it("accepts the reader's empty apiOrigin and relayOrigin (not configured) and still refuses a value that is not a URL", async () => {
    const { hostConfigSchema } = await load();
    const ok = (apiOrigin: string, relayOrigin: string) =>
      hostConfigSchema.safeParse({ apiOrigin, relayOrigin, environment: "local" }).success;
    // the contract types both as string, and the reader passes "" when PUBLIC_SOCIAL_API_ORIGIN or _RELAY_ORIGIN is unset
    expect([
      ok("", ""),
      ok("https://social.example", ""),
      ok("", "wss://relay.example"),
      ok("http://localhost:3200", "ws://localhost:8787"),
    ]).toEqual([true, true, true, true]);
    expect([ok("not a url", ""), ok("", "relay"), ok(" ", "")]).toEqual([false, false, false]);
  });
});
