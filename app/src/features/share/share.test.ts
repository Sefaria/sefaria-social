// What a share sends (spec 027): an absolute link through host.href, the opening words, WhatsApp and e-mail links.
// @feature FEED-068 Share a post or a profile
import { describe, expect, it } from "vitest";
import { absoluteLink, emailLink, opening, whatsappLink } from "./share";

describe("share", () => {
  it("builds the absolute link with host.href, cuts the opening words at a word, and encodes WhatsApp and e-mail links", () => {
    const host = { href: (to: string) => `/he${to}` } as unknown as Parameters<typeof absoluteLink>[0];
    expect(absoluteLink(host, "/social/p/abc")).toMatch(/^https?:\/\/[^/]+\/he\/social\/p\/abc$/);
    expect(absoluteLink(null, "/social/u/xyz")).toMatch(/\/social\/u\/xyz$/);
    expect(opening("short")).toBe("short");
    const long = opening("word ".repeat(60), 40);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(whatsappLink("A thought", "https://x.test/p")).toBe(
      `https://wa.me/?text=${encodeURIComponent("A thought\nhttps://x.test/p")}`,
    );
    expect(emailLink("Subject", "Body", "https://x.test/p")).toBe(
      `mailto:?subject=Subject&body=${encodeURIComponent("Body\n\nhttps://x.test/p")}`,
    );
  });
});
