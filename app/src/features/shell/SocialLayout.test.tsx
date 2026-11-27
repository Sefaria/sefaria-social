// @vitest-environment jsdom
// Spec 060 AC-002: the Labs mark and byline beside social's nav, in both interface languages.
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "~/features/session/test-surface";
import { BrandMark } from "~/ui/BrandMark";
import { langAttrs, stringsFor } from "./strings";

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

describe("the Labs mark and byline (spec 060)", () => {
  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-002
  it("shows the decorative Social mark and 'from Sefaria Labs', in Hebrew with lang and dir", async () => {
    const en = await render(createElement(BrandMark, { byline: stringsFor("english").labsByline, ...langAttrs("english") }));
    teardown.push(en.unmount);
    const mark = en.el.querySelector("[data-labs-brand] svg");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    // The Sefaria Social mark: its two cursors are the live teal and the gold (two learners on one text)
    expect([...(mark?.querySelectorAll("path[data-cursor]") ?? [])].map((p) => p.getAttribute("stroke"))).toEqual([
      "var(--labs-live)",
      "var(--labs-gold)",
    ]);
    expect(en.el.querySelector("[data-labs-brand]")?.textContent).toBe("from Sefaria Labs");

    const he = await render(createElement(BrandMark, { byline: stringsFor("hebrew").labsByline, ...langAttrs("hebrew") }));
    teardown.push(he.unmount);
    const byline = he.el.querySelector("[data-labs-brand]");
    expect([byline?.getAttribute("lang"), byline?.getAttribute("dir"), byline?.textContent]).toEqual([
      "he",
      "rtl",
      "מבית Sefaria Labs",
    ]);
  });
});
