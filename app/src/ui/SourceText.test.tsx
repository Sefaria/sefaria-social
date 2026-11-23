// @vitest-environment jsdom
// Spec 017: SourceText renders the recorded answer's Hebrew and English with their own lang and dir, plain text only, a
// fallback line on failure, and fetches only once the card is near the viewport. The component loads through
// import.meta.glob so that, on a base without it, the first assertion fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextSource } from "~/lib/sefaria-text";
import type * as TextModule from "~/lib/sefaria-text";
import type * as SourceTextModule from "./SourceText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mods = import.meta.glob<typeof SourceTextModule>("./SourceText.tsx");
const textMods = import.meta.glob<typeof TextModule>("../lib/sefaria-text.ts");
const FIXTURES = path.resolve(import.meta.dirname, "../../../harness/fixtures/texts");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

/** A stand-in IntersectionObserver: tests decide when an element comes near the viewport. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(
    readonly cb: IntersectionObserverCallback,
    readonly opts?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    this.targets.length = 0;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  static comeNear() {
    for (const o of FakeObserver.all)
      o.cb(
        o.targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
        o as unknown as IntersectionObserver,
      );
  }
}

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  FakeObserver.all = [];
  vi.unstubAllGlobals();
});

/** The text module, through import.meta.glob: on a base without it the assertion fails, not the import. */
async function textModule() {
  const mod = await textMods["../lib/sefaria-text.ts"]?.();
  expect(mod, "app/src/lib/sefaria-text.ts exists").toBeDefined();
  return mod!;
}

async function mount(source: TextSource, refs: string[], interfaceLang: "english" | "hebrew" = "english") {
  const mod = await mods["./SourceText.tsx"]?.();
  expect(mod, "app/src/ui/SourceText.tsx exists").toBeDefined();
  const { SourceText, TextSourceContext } = mod!;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const tree = createElement(
    TextSourceContext.Provider,
    { value: source },
    refs.map((textRef, i) => createElement(SourceText, { key: i, textRef, interfaceLang, unavailableLabel: "Text unavailable" })),
  );
  await act(async () => root.render(tree));
  teardown.push(() => {
    act(() => root.unmount());
    el.remove();
  });
  return el;
}

const recorded = async () =>
  (await textModule()).createTextSource({
    fetch: async (url) => new Response(fixture(url.includes("Genesis") ? "Genesis_1.json" : "Psalms_23.json")),
  });

describe("SourceText", () => {
  // @feature FEED-017 Source-text renderer from the public text API
  // @ac 017/AC-001
  it("renders the first segments in Hebrew and English, each with its own lang and dir, Hebrew first in Hebrew", async () => {
    const el = await mount(await recorded(), ["Genesis 1"], "hebrew");
    await vi.waitFor(() => expect(el.querySelector("[data-source-text]")?.getAttribute("data-source-text")).toBe("ready"));
    const blocks = [...el.querySelectorAll("[data-source-text] p")];
    expect(blocks.map((p) => [p.getAttribute("lang"), p.getAttribute("dir")])).toEqual([
      ["he", "rtl"],
      ["en", "ltr"],
    ]);
    const genesis = JSON.parse(fixture("Genesis_1.json")) as { versions: { text: string[] }[] };
    expect(blocks.map((p) => p.textContent)).toEqual(genesis.versions.map((v) => `${v.text[0]} ${v.text[1]}`));
  });

  // @feature FEED-017 Source-text renderer from the public text API
  // @ac 017/AC-001
  it("puts English first in the English interface", async () => {
    const el = await mount(await recorded(), ["Genesis 1"], "english");
    await vi.waitFor(() => expect(el.querySelectorAll("[data-source-text] p")).toHaveLength(2));
    expect([...el.querySelectorAll("[data-source-text] p")].map((p) => p.getAttribute("lang"))).toEqual(["en", "he"]);
  });

  // @feature FEED-017 Source-text renderer from the public text API
  // @ac 017/AC-002
  it("never puts an element from the API into the DOM, and says the text is unavailable when the answer is wrong", async () => {
    const evil = JSON.stringify({
      ref: "Genesis 1:1",
      versions: [
        { language: "en", direction: "ltr", text: ["<b>In</b> the <img src=x onerror=alert(1)>beginning<script>x()</script>"] },
      ],
    });
    const answers = [new Response(evil), new Response('{"error":"no"}')];
    const { createTextSource } = await textModule();
    const el = await mount(createTextSource({ fetch: async () => answers.shift()! }), ["Genesis 1:1", "Nowhere 1"]);
    await vi.waitFor(() =>
      expect([...el.querySelectorAll("[data-source-text]")].map((d) => d.getAttribute("data-source-text"))).toEqual([
        "ready",
        "unavailable",
      ]),
    );
    expect(el.querySelector("[data-source-text] p")!.textContent).toBe("In the beginning");
    expect(el.querySelectorAll("img, script, b").length).toBe(0);
    expect(el.querySelectorAll("[data-source-text]")[1]!.textContent).toBe("Text unavailable");
  });

  // @feature FEED-053 Prefetch on visibility and on press
  // @ac 017/AC-003
  it("requests nothing until the text is within 200px of the viewport, then one request per ref", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const source = await recorded();
    const el = await mount(source, ["Genesis 1", "Genesis 1"]);
    expect(source.requests()).toEqual({});
    expect(FakeObserver.all.map((o) => o.opts?.rootMargin)).toEqual(["200px", "200px"]);
    await act(async () => FakeObserver.comeNear());
    await vi.waitFor(() => expect(el.querySelectorAll("[data-source-text=ready]")).toHaveLength(2));
    expect(source.requests()).toEqual({ "Genesis 1": 1 });
  });
});
