// Spec 060: the manifest inside a Claude asset's file (plan 5.1), read without running the file.
// @feature SHIUR-008 Save a Claude asset with its manifest and refs checked, as immutable versions
import { describe, expect, it } from "vitest";
import { readManifest } from "./asset-manifest";

const block = (json: string, attrs = 'type="application/json" id="sefaria-asset"') =>
  `<!doctype html><html><head><script ${attrs}>${json}</script></head><body><script>1</script></body></html>`;
const VALID = JSON.stringify({
  v: 1,
  title: "The Seven Days",
  description: "A scrolling story of creation.",
  lang: "en",
  refs: [{ ref: "Genesis 1:1-5", label: "Day one" }, { ref: "Genesis 1:6-8" }],
});
const codes = (html: string) => {
  const r = readManifest(html);
  return r.ok ? [] : r.problems.map((p) => p.code);
};

describe("readManifest", () => {
  it("reads one manifest block, attributes in any order and either quote", () => {
    for (const attrs of ['type="application/json" id="sefaria-asset"', "id='sefaria-asset' type='application/json'"])
      expect(readManifest(block(VALID, attrs))).toEqual({
        ok: true,
        manifest: {
          v: 1,
          title: "The Seven Days",
          description: "A scrolling story of creation.",
          lang: "en",
          refs: [
            { ref: "Genesis 1:1-5", label: "Day one" },
            { ref: "Genesis 1:6-8", label: null },
          ],
        },
      });
  });

  it("names each problem with a stable code and a message that says what to change", () => {
    expect(codes("<html><script>var x</script></html>")).toEqual(["manifest.missing"]);
    expect(codes(block(VALID) + block(VALID))).toEqual(["manifest.multiple"]);
    expect(codes(block("{not json"))).toEqual(["manifest.json"]);
    expect(codes(block(JSON.stringify({ v: 2, title: "x", refs: [{ ref: "Genesis 1:1" }] })))).toEqual(["manifest.version"]);
    expect(codes(block(JSON.stringify({ v: 1, refs: [{ ref: "Genesis 1:1" }] })))).toEqual(["manifest.invalid"]);
    expect(codes(block(JSON.stringify({ v: 1, title: "x", refs: [] })))).toEqual(["refs.missing"]);
    const many = Array.from({ length: 101 }, (_, i) => ({ ref: `Genesis 1:${i + 1}` }));
    expect(codes(block(JSON.stringify({ v: 1, title: "x", refs: many })))).toEqual(["refs.too_many"]);
    const r = readManifest(block(JSON.stringify({ v: 1, refs: [{ ref: "Genesis 1:1" }] })));
    expect(r.ok ? "" : r.problems[0]!.message).toMatch(/title/);
  });
});
