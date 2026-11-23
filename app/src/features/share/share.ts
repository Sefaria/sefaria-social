// What a share sends (spec 027): the absolute address of a social page on the reader's site, built with host.href (R15), and
// the WhatsApp and e-mail links that carry it.
import type { SurfaceHost } from "@sefaria-social/host-contract";

/** The absolute link to a social path, on the page's own site (the reader's), or the path itself when there is no page. */
export function absoluteLink(host: SurfaceHost | null, path: string): string {
  const href = host ? host.href(path) : path;
  const base = typeof window !== "undefined" ? window.location.origin : "https://www.sefaria.org";
  return new URL(href, base).toString();
}

/** The opening words of a text, cut at a word boundary. */
export function opening(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export const whatsappLink = (text: string, link: string) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`;

export const emailLink = (subject: string, text: string, link: string) =>
  `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n${link}`)}`;
