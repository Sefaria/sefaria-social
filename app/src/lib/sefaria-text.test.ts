// Spec 017: the text source for cards — plain text only, one request per ref, recorded answers parse. The module loads
// through import.meta.glob so that, on a base without it, the first assertion fails.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type * as TextModule from "./sefaria-text";

const mods = import.meta.glob<typeof TextModule>("./sefaria-text.ts");
const load = async () => {
  const mod = await mods["./sefaria-text.ts"]?.();
  expect(mod, "app/src/lib/sefaria-text.ts exists").toBeDefined();
  return mod!;
};
const FIXTURES = path.resolve(import.meta.dirname, "../../../harness/fixtures/texts");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as unknown;
const answer = (segment: string) => ({
  ref: "Genesis 1:1",
  heRef: "בראשית א׳:א׳",
  versions: [{ language: "en", direction: "ltr", text: [segment] }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("the text source", () => {
  // @feature FEED-017 Source-text renderer from the public text API
  // @ac 017/AC-002
  it("reduces markup and entities to plain text, so nothing from the API becomes an element", async () => {
    const { toPlainText, toSourceText, TextAnswer } = await load();
    const evil = "<b>In</b> the <img src=x onerror=alert(1)>beginning &amp; more<script>x()</script><!-- c -->";
    expect(toPlainText(evil)).toBe("In the beginning & more");
    expect(toPlainText("a &lt;b&gt; &#1488;&#x5D1; &nbsp; c")).toBe("a b אב c");
    expect(toPlainText("x < y and y > z")).toBe("x y and y z");
    const data = toSourceText(TextAnswer.parse(answer(evil)));
    expect(data.blocks).toEqual([{ lang: "en", dir: "ltr", segments: ["In the beginning & more"] }]);
  });

  // @feature FEED-017 Source-text renderer from the public text API
  // @ac 017/AC-002
  it("refuses an answer that is not a text, and a failed request, without caching the failure", async () => {
    const { createTextSource } = await load();
    const answers = [json({ nope: true }), json({}, 500), json(answer("ok"))];
    const source = createTextSource({ fetch: async () => answers.shift()! });
    await expect(source.get("Genesis 1:1")).rejects.toThrow("not a text");
    await expect(source.get("Genesis 1:1")).rejects.toThrow("500");
    await expect(source.get("Genesis 1:1")).resolves.toMatchObject({ heRef: "בראשית א׳:א׳" });
    expect(source.requests()).toEqual({ "Genesis 1:1": 3 });
  });

  // @feature FEED-053 Prefetch on visibility and on press
  // @ac 017/AC-003
  it("sends one request per ref while its answer is cached, to the page's own origin", async () => {
    const { createTextSource, textUrl } = await load();
    const urls: string[] = [];
    const source = createTextSource({
      fetch: async (url) => {
        urls.push(url);
        return json(fixture("Genesis_1.json"));
      },
    });
    source.prefetch("Genesis 1");
    const [a, b] = await Promise.all([source.get("Genesis 1"), source.get("Genesis 1")]);
    expect(a).toBe(b);
    expect(urls).toEqual(["/api/v3/texts/Genesis%201?version=primary&version=translation&return_format=text_only"]);
    expect(textUrl("Berakhot 2a", "https://www.sefaria.org/")).toBe(
      "https://www.sefaria.org/api/v3/texts/Berakhot%202a?version=primary&version=translation&return_format=text_only",
    );
    expect(source.titles("Genesis 1")).toEqual({ heRef: "בראשית א׳", title: "Genesis" });
    expect(source.titles("Exodus 3")).toBeNull();
  });

  it("parses every recorded fixture the harness serves", async () => {
    const { TextAnswer, toSourceText } = await load();
    const names = readdirSync(FIXTURES).filter((n) => n.endsWith(".json"));
    expect(names.length).toBeGreaterThanOrEqual(4);
    const parsed = names.map((n) => toSourceText(TextAnswer.parse(fixture(n))).blocks.map((b) => b.lang));
    expect(parsed).toEqual(names.map(() => ["he", "en"]));
  });
});
