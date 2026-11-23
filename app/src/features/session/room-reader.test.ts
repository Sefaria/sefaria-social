// R13 and R14 (spec 013): what a follower applies and what a publisher sends. Loaded through import.meta.glob so that, on a
// base without the module, the first assertion fails.
import { describe, expect, it } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as RoomReaderModule from "./room-reader";
import type * as TextModule from "~/lib/sefaria-text";

const modules = import.meta.glob<typeof RoomReaderModule>("./room-reader.ts");
const textModules = import.meta.glob<typeof TextModule>("../../lib/sefaria-text.ts");
async function load() {
  const mod = await modules["./room-reader.ts"]?.();
  expect(mod, "app/src/features/session/room-reader.ts exists").toBeDefined();
  return mod!;
}

const SETTINGS = { "sefaria.settings": { v: 1, value: { fontSize: 22, language: "hebrew" } } };
const scopes = { "sefaria.settings": "personal" as const };

describe("room reader", () => {
  // @feature SESS-048 Nothing personal applied or sent
  // @ac 013/AC-005
  it("applies only the slices that are moment-scoped in the follower's reader; personal and unknown slices never", async () => {
    const { roomReader } = await load();
    const fake = createFakeHost({
      url: "/Psalms.1?ctx=social.room.room-00001",
      slices: { ...SETTINGS, "sefaria.scroll": { v: 1, value: { seg: 1 } } },
      sliceScopes: scopes,
    });
    const reader = roomReader(fake.host.reader.state, { isOpen: () => true });
    await reader.api.applySnapshot(
      {
        v: 1,
        url: "/Genesis.3",
        nav: null,
        slices: {
          "sefaria.settings": { v: 1, value: { fontSize: 9, language: "english" } },
          "sefaria.scroll": { v: 1, value: { seg: 7 } },
          "other.reader.thing": { v: 1, value: 1 },
          "social.summary": { v: 1, value: { ref: "Genesis 3", title: "Genesis 3" } },
        },
      },
      { origin: "follow", persist: false },
    );
    expect(fake.calls.applied.map((a) => ({ url: a.snapshot.url, slices: Object.keys(a.snapshot.slices), ctx: a.ctx }))).toEqual([
      { url: "/Genesis.3", slices: ["sefaria.scroll"], ctx: { origin: "follow", persist: false } },
    ]);
    expect(fake.host.reader.state.getSnapshot().slices["sefaria.settings"]).toEqual(SETTINGS["sefaria.settings"]);
    expect(fake.url()).toBe("/Genesis.3?ctx=social.room.room-00001");
  });

  // @feature SESS-048 Nothing personal applied or sent
  // @ac 013/AC-005
  it("holds what arrives while the gate is closed and applies all of it when released", async () => {
    const { roomReader } = await load();
    const fake = createFakeHost({ url: "/social/r/room-00001", slices: { "sefaria.scroll": { v: 1, value: { seg: 1 } } } });
    let open = false;
    const reader = roomReader(fake.host.reader.state, { isOpen: () => open });
    const scroll = (seg: number) => ({ "sefaria.scroll": { v: 1, value: { seg } } });
    await reader.api.applySnapshot(
      { v: 1, url: "/Genesis.1", nav: null, slices: scroll(2) },
      { origin: "follow", persist: false },
    );
    await reader.api.applySnapshot({ v: 1, url: "/Genesis.2", nav: null, slices: {} }, { origin: "follow", persist: false });
    expect(fake.calls.applied).toEqual([]);
    open = true;
    await reader.release();
    expect(fake.calls.applied.map((a) => [a.snapshot.url, a.snapshot.slices])).toEqual([["/Genesis.2", scroll(2)]]);
    expect(await reader.release()).toBeNull(); // nothing new to apply
  });

  // @feature SESS-048 Nothing personal applied or sent
  // @ac 013/AC-006
  it("publishes no ctx, no personal slice and no search words, and adds the summary slice", async () => {
    const { outgoing, roomReader } = await load();
    // The fixture holds both things that must never leave: a ctx in the url and a personal slice.
    const fixture = {
      v: 1 as const,
      url: "/Genesis.3?lang=bi&ctx=social.room.room-00001&with=all",
      nav: { nav: "go", terms: ["light"] },
      slices: { ...SETTINGS, "sefaria.scroll": { v: 1, value: { seg: 4 } } },
    };
    const out = outgoing(fixture, new Set(["sefaria.scroll"]));
    expect(out).toEqual({
      v: 1,
      url: "/Genesis.3?lang=bi&with=all",
      nav: { nav: "go" },
      slices: {
        "sefaria.scroll": { v: 1, value: { seg: 4 } },
        "social.summary": { v: 1, value: { ref: "Genesis 3", heRef: null, title: "Genesis 3" } },
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/ctx|fontSize|light/);

    // Through the view the session client reads: the same, from the host's real state.
    const fake = createFakeHost({ url: fixture.url, slices: fixture.slices, sliceScopes: scopes });
    const reader = roomReader(fake.host.reader.state, { isOpen: () => false });
    const seen: string[] = [];
    reader.api.subscribe((_c, s) => seen.push(JSON.stringify(s)));
    expect(JSON.stringify(reader.api.getSnapshot())).not.toMatch(/ctx|sefaria\.settings/);
    fake.localMove("/Genesis.4");
    expect(seen.map((s) => JSON.parse(s).url)).toEqual(["/Genesis.4"]);
    expect(seen.join()).not.toMatch(/ctx|sefaria\.settings/);
    expect(JSON.parse(seen[0]!).slices["social.summary"].value).toEqual({ ref: "Genesis 4", heRef: null, title: "Genesis 4" });
  });

  // @feature SESS-054 Stream summary carries heRef and the source's title
  // @ac 016/AC-004
  it("adds heRef and the source's title from the text API's answer, and republishes when it lands without another move", async () => {
    const { roomReader } = await load();
    const text = await textModules["../../lib/sefaria-text.ts"]?.();
    expect(text, "app/src/lib/sefaria-text.ts exists").toBeDefined();
    const answer = { ref: "Genesis 1", heRef: "בראשית א׳", indexTitle: "Genesis", versions: [] };
    let land: () => void = () => undefined;
    const titles = text!.createTextSource({
      fetch: () => new Promise((resolve) => (land = () => resolve(new Response(JSON.stringify(answer))))),
    });
    const fake = createFakeHost({ url: "/Genesis.1", slices: { "sefaria.scroll": { v: 1, value: { seg: 1 } } } });
    const reader = roomReader(fake.host.reader.state, { isOpen: () => false, titles });
    const summaries: unknown[] = [];
    reader.api.subscribe((_c, s) => summaries.push(s.slices["social.summary"]?.value));
    expect(reader.api.getSnapshot().slices["social.summary"]?.value).toEqual({
      ref: "Genesis 1",
      heRef: null,
      title: "Genesis 1",
    });
    expect(titles.requests()).toEqual({ "Genesis 1": 1 });
    land();
    await expect.poll(() => summaries).toEqual([{ ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis" }]);
  });
});
