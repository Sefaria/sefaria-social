// Spec 060: social in the Sefaria Labs brand (Daylight and Night). The layer is CSS, so these tests read the stylesheets
// themselves: the palette's contrast, where the signal colours may appear, which classes take the mono face, and the motion.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = (rel: string) => (existsSync(path.join(src, rel)) ? readFileSync(path.join(src, rel), "utf8") : "");

/** `--labs-<name>: #hex;` declarations in the brand module. */
function labsTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css("ui/brand.module.css").matchAll(/--(labs-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[m[1]!] = m[2]!.toUpperCase();
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

/** The body of the first rule whose selector is exactly `selector` in a stylesheet. */
function rule(sheet: string, selector: string): string {
  const at = sheet.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
}

const SHEETS = [
  "features/feed/card.module.css",
  "features/post/embed-card.module.css",
  "features/post/post.module.css",
  "features/feed/home.module.css",
  "features/profile/profile.module.css",
  "features/shell/shell.module.css",
  "ui/kit.module.css",
];

/** Every rule (selector) in the sheets above whose body uses `var(--<token>`. */
const uses = (token: string) =>
  SHEETS.flatMap((s) =>
    [...css(s).matchAll(new RegExp(`([^{}]+)\\{[^}]*var\\(--${token}[,)]`, "g"))].map((m) => `${s} ${m[1]!.trim()}`),
  ).sort();

describe("social in the Sefaria Labs brand (spec 060)", () => {
  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-001
  it("defines Daylight and Night, re-maps the reader's tokens, keeps text at 4.5:1 or more, and sets headings in the serif", () => {
    const t = labsTokens();
    expect([t["labs-day-page"], t["labs-day-ink"], t["labs-day-brand"], t["labs-day-highlight"]]).toEqual([
      "#FFFFFF",
      "#1B2233",
      "#1E3F73",
      "#F6E7B8",
    ]);
    expect([t["labs-night-page"], t["labs-night-ink"], t["labs-night-brand"]]).toEqual(["#0B1426", "#F2EDE3", "#8FB0E8"]);
    const low: string[] = [];
    for (const theme of ["day", "night"]) {
      for (const ink of ["ink", "muted", "brand", "gold", "live", "spark"]) {
        const ratio = contrast(t[`labs-${theme}-${ink}`] ?? "#000000", t[`labs-${theme}-page`] ?? "#000000");
        if (ratio < 4.5) low.push(`${theme} ${ink} ${ratio}`);
      }
    }
    expect(low).toEqual([]);
    const brand = css("ui/brand.module.css");
    for (const token of ["--sefaria-color-text", "--sefaria-color-surface", "--sefaria-color-brand", "--sefaria-color-page"]) {
      expect(rule(brand, ".labs")).toContain(`${token}: light-dark(`);
    }
    expect(rule(brand, ".labs :where(h1)")).toContain("font-family: var(--sefaria-font-text-en");
  });

  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-003
  it("speaks in three voices: the system in the mono, people in the serif", () => {
    const MONO: [string, string][] = [
      ["features/post/post.module.css", ".sourceRef"],
      ["features/post/post.module.css", ".time"],
      ["features/post/post.module.css", ".number"],
      ["features/shell/shell.module.css", ".navLink"],
      ["ui/kit.module.css", ".button"],
      ["ui/kit.module.css", ".tab"],
      ["ui/kit.module.css", ".iconButton"],
      ["ui/kit.module.css", ".badge"],
      ["ui/kit.module.css", ".count"],
      ["ui/kit.module.css", ".avatar"],
      ["features/feed/feed.module.css", ".sectionTitle"],
      ["features/feed/card.module.css", ".status"],
      ["features/profile/profile.module.css", ".railTitle"],
      ["features/profile/profile.module.css", ".postsTitle"],
      ["features/feed/home.module.css", "main:has(> .home) > h1 + p"],
      ["ui/brand.module.css", ".mark"],
    ];
    const SERIF: [string, string][] = [
      ["features/post/post.module.css", ".body"],
      ["features/post/post.module.css", ".author"],
      ["features/feed/card.module.css", ".heading"],
      ["features/profile/profile.module.css", ".name"],
      ["features/profile/profile.module.css", ".suggestionName"],
    ];
    expect(MONO.filter(([sheet, sel]) => !rule(css(sheet), sel).includes("font-family: var(--labs-font-mono"))).toEqual([]);
    expect(SERIF.filter(([sheet, sel]) => !rule(css(sheet), sel).includes("font-family: var(--sefaria-font-text-en"))).toEqual(
      [],
    );
    for (const [sheet, sel] of MONO.filter(([, sel]) => !/count|number|time|avatar|iconButton/.test(sel)))
      expect(rule(css(sheet), sel), `${sheet} ${sel}`).toContain("text-transform: uppercase");
  });

  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-004
  it("uses the teal only for live things, the gold for warmth and action, and the violet nowhere", () => {
    expect(uses("labs-live")).toEqual([
      'features/feed/card.module.css .card[data-feed-card="live"]',
      "features/feed/card.module.css .dot",
      "features/feed/card.module.css .live",
      "features/post/embed-card.module.css .dot",
      "features/post/embed-card.module.css .live",
    ]);
    expect(uses("labs-gold")).toEqual([
      'features/post/post.module.css .reaction[aria-pressed="true"] svg',
      "ui/kit.module.css .count",
    ]);
    expect(uses("labs-sun")).toEqual([
      'features/shell/shell.module.css .navLink[data-status="active"]',
      "ui/kit.module.css .primary",
      'ui/kit.module.css .tab[aria-selected="true"]::after',
    ]);
    expect(uses("labs-spark")).toEqual([]);
    expect(rule(css("features/feed/card.module.css"), '.card[data-feed-card="recent"] .link')).toContain(
      "var(--sefaria-color-text-muted",
    );
    const t = labsTokens();
    expect(contrast(t["labs-on-sun"] ?? "#FFFFFF", t["labs-day-sun"] ?? "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  // @feature FEED-077 Social wears the Sefaria Labs brand — a visual preview
  // @ac 060/AC-007
  it("pulses the live dot and pops a given Yasher koach, and stops both under reduced motion", () => {
    for (const sheet of ["features/feed/card.module.css", "features/post/embed-card.module.css"]) {
      expect(rule(css(sheet), ".dot")).toContain("animation: ");
      expect(css(sheet)).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.dot\s*\{\s*animation: none;/);
    }
    const post = css("features/post/post.module.css");
    expect(rule(post, '.reaction[aria-pressed="true"] svg')).toContain("animation: ");
    expect(post).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.reaction\[aria-pressed="true"\] svg\s*\{\s*animation: none;/,
    );
  });
});
