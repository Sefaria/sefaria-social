import { expect, it } from "vitest";
import { chaptersOf } from "./chapters";
// @feature SHIUR-008 Revisit a finished shiur through its texts and transcript
// @ac 061/AC-001
it("excludes navigation summaries and stale text summaries on navigation pages", () => {
  const messages = [
    [0, "/texts", "texts"],
    [10000, "/Genesis.1", "Genesis 1"],
    [20000, "/search?q=Genesis", "Genesis 1:1"],
    [30000, "/Malachi.1.7", "Malachi 1:7"],
    [40000, "/Genesis.1", "Genesis 1"],
  ].map(([t, url, ref], seq) => ({
    type: "keyframe" as const,
    seq,
    t: Number(t),
    snapshot: { v: 1 as const, url: String(url), nav: null, slices: { "social.summary": { v: 1, value: { ref } } } },
  }));
  expect(chaptersOf(messages).chapters.map((c) => c.ref)).toEqual(["Genesis 1", "Malachi 1:7", "Genesis 1"]);
});
