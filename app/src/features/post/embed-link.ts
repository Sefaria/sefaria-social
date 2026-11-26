// Session links in a post's text (spec 055 AC-001): a room (`/social/r/<id>`), broadcast (`/social/b/<id>`) or recording
// (`/social/rec/<id>`) link, as a bare path or an http(s) URL on a Sefaria origin or the page's own. Pure: the composer cuts
// the first one out of the text and shows it as a card; the server stores only its kind and id (decision 0013).

export type EmbedKind = "room" | "broadcast" | "recording";

export interface EmbedLink {
  kind: EmbedKind;
  id: string;
  /** Where the link starts and ends in the text, and the link as written. */
  start: number;
  end: number;
  text: string;
}

const KINDS: Record<string, EmbedKind> = { r: "room", b: "broadcast", rec: "recording" };
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// An optional origin, then the path; the link ends at the id (a query or fragment after it is kept with it).
const LINK = new RegExp(`(?:(https?://[^\\s/?#]+))?/social/(rec|r|b)/(${UUID})(?:[?#][^\\s]*)?(?=$|[\\s.,;:!?)\\]}'"])`, "g");

/** Sefaria's own hosts: production, Israel, and every `*.sefaria.org` host (cauldrons, previews). */
export function isSefariaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "sefaria.org" || h === "sefaria.org.il" || h === "www.sefaria.org.il" || h.endsWith(".sefaria.org");
}

function originAccepted(origin: string, pageOrigin: string | null): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return isSefariaHost(u.hostname) || (pageOrigin !== null && u.origin === pageOrigin);
  } catch {
    return false;
  }
}

/** The first session link in `text`, or null. A bare path must start the text or follow a space. */
export function findEmbedLink(text: string, pageOrigin: string | null = null): EmbedLink | null {
  for (const m of text.matchAll(LINK)) {
    const start = m.index;
    const origin = m[1];
    if (start > 0 && !/\s/.test(text[start - 1]!)) continue; // glued to other text: not a link of its own
    if (origin && !originAccepted(origin, pageOrigin)) continue;
    return { kind: KINDS[m[2]!]!, id: m[3]!.toLowerCase(), start, end: start + m[0].length, text: m[0] };
  }
  return null;
}

/** The page's own origin from a host href (absolute when the reader builds absolute links), or null. */
export function originOf(href: string | undefined): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  try {
    return new URL(href).origin;
  } catch {
    return null;
  }
}

/** The social page a card opens (R8: the host builds the href and handles a plain click). */
export const embedPath = (kind: EmbedKind, id: string): string =>
  `/social/${kind === "room" ? "r" : kind === "broadcast" ? "b" : "rec"}/${id}`;
