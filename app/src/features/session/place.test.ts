import { describe, expect, it } from "vitest";
import type { ReaderSnapshot } from "@sefaria-social/session";
import { drifted, placeOfRef } from "./place";

const at = (ref: string | null, url = "/Genesis.1", summary?: string): ReaderSnapshot => ({
  v: 1,
  url,
  nav: null,
  slices: {
    ...(ref ? { "sefaria.scroll": { v: 1, value: { k1: { ref, offset: 0 } } } } : {}),
    ...(summary ? { "social.summary": { v: 1, value: { ref: summary, heRef: null, title: summary } } } : {}),
  },
});

// @feature SESS-070 Sticky following: break away only by a clear move
describe("place", () => {
  it("reads section and segment from a ref, ranges by where they start", () => {
    expect(placeOfRef("Genesis 1:5")).toEqual({ section: "Genesis 1", segment: 5 });
    expect(placeOfRef("Genesis 1:5-8")).toEqual({ section: "Genesis 1", segment: 5 });
    expect(placeOfRef("Genesis 1:5-2:3")).toEqual({ section: "Genesis 1", segment: 5 });
    expect(placeOfRef("Berakhot 2a:7")).toEqual({ section: "Berakhot 2a", segment: 7 });
    expect(placeOfRef("Rashi on Genesis 1:1:2")).toEqual({ section: "Rashi on Genesis 1:1", segment: 2 });
    expect(placeOfRef("Genesis 1")).toEqual({ section: "Genesis 1", segment: null });
    expect(placeOfRef("  ")).toBeNull();
  });

  it("is away only in another section or 5 or more segments apart", () => {
    expect(drifted(at("Genesis 1:3"), at("Genesis 1:3"))).toBe(false);
    expect(drifted(at("Genesis 1:7"), at("Genesis 1:3"))).toBe(false);
    expect(drifted(at("Genesis 1:8"), at("Genesis 1:3"))).toBe(true);
    expect(drifted(at("Genesis 2:3"), at("Genesis 1:3"))).toBe(true);
    expect(drifted(at("Exodus 1:3"), at("Genesis 1:3"))).toBe(true);
  });

  it("falls back to the summary's ref, then to the path", () => {
    expect(drifted(at(null, "/a", "Genesis 1:4"), at(null, "/b", "Genesis 1:6"))).toBe(false);
    expect(drifted(at(null, "/Genesis.1"), at(null, "/Genesis.1?lang=he"))).toBe(false);
    expect(drifted(at(null, "/Genesis.1"), at(null, "/Exodus.1"))).toBe(true);
    // A section-level ref on one side: same section is not away.
    expect(drifted(at("Genesis 1"), at("Genesis 1:9"))).toBe(false);
  });
});
