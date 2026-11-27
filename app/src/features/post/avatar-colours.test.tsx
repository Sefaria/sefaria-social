// @vitest-environment jsdom
// Spec 060 AC-005: every learner wears a cursor colour as a ring, the same each time; never a signal colour (teal, violet).
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "~/features/session/test-surface";
import { Avatar, CURSOR_TONES } from "~/ui/Avatar";

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

const CURSORS = ["gold", "blue", "sky", "coral", "moss", "rose"];
/** The Labs signals (brand.module.css): teal is live, violet is a model. No learner wears them. */
const SIGNALS = ["#00796F", "#3CE0C4", "#6B3A8E", "#B98CF0"];

describe("avatar colours (spec 060)", () => {
  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-005
  it("rings each person in a cursor colour, the same every time, never a signal, each at 3:1 or more on white", async () => {
    expect(Object.keys(CURSOR_TONES)).toEqual(CURSORS);
    const hexes = Object.values(CURSOR_TONES).map((h) => h.toUpperCase());
    expect(hexes.filter((hex) => contrast("#FFFFFF", hex) < 3)).toEqual([]);
    expect(hexes.filter((hex) => SIGNALS.includes(hex))).toEqual([]);

    const ids = ["u:910001", "u:910002", "u:910003", "u:910004", "u:910005", "de000000-0000-4000-8000-000000000001"];
    const draw = async () => {
      const view = await render(
        createElement(
          "div",
          null,
          ids.map((id) => createElement(Avatar, { key: id, id, name: "Noa Shapiro", kind: "person" })),
        ),
      );
      teardown.push(view.unmount);
      return [...view.el.querySelectorAll<HTMLElement>("[data-avatar]")].map((el) =>
        el.style.getPropertyValue("--avatar-tone").toUpperCase(),
      );
    };
    const first = await draw();
    expect(first.filter((hex) => !hexes.includes(hex))).toEqual([]);
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(await draw()).toEqual(first);
  });
});
