// Text from Sefaria's public text API, for cards (plan 4.5; specs 016 and 017). Until contract v1.1 gives social
// `renderSegment`, social fetches the text itself. The API's answer is untrusted: it is validated with a schema, and every
// string is reduced to plain text (tags removed, a few entities decoded) before anything renders it. React then escapes it.
//
// The request goes to the reader page's own origin (`/api/v3/texts/…`): in the reader that is Sefaria; on the harness it is
// the harness, which serves recorded answers (harness/fixtures/texts). Decision 0009.
import { z } from "zod";

/** The query social sends (harness/fixtures/record-texts.mjs records with the same one). */
export const TEXT_QUERY = "version=primary&version=translation&return_format=text_only";

/** `/api/v3/texts/<ref>?…`, relative to `origin` ("" for the page's own origin). */
export function textUrl(ref: string, origin = ""): string {
  return `${origin.replace(/\/+$/, "")}/api/v3/texts/${encodeURIComponent(ref)}?${TEXT_QUERY}`;
}

const MAX_SEGMENT = 2_000;
const MAX_SEGMENTS = 400;
const Segments = z.union([z.string(), z.array(z.union([z.string(), z.array(z.unknown())])).max(MAX_SEGMENTS)]);

export const TextAnswer = z.object({
  ref: z.string().min(1).max(300),
  heRef: z.string().max(300).optional(),
  title: z.string().max(300).optional(),
  heTitle: z.string().max(300).optional(),
  indexTitle: z.string().max(300).optional(),
  heIndexTitle: z.string().max(300).optional(),
  versions: z
    .array(
      z.object({
        language: z.string().max(10),
        direction: z.enum(["rtl", "ltr"]).optional(),
        versionTitle: z.string().max(300).optional(),
        text: Segments,
      }),
    )
    .max(10),
});
export type TextAnswer = z.infer<typeof TextAnswer>;

/** One version, ready to render: its language and direction, and its first segments as plain text. */
export interface TextBlock {
  lang: "he" | "en";
  dir: "rtl" | "ltr";
  segments: string[];
}

/** What a card shows: the ref's names and up to two blocks (Hebrew and English). */
export interface SourceTextData {
  ref: string;
  heRef: string | null;
  title: string | null;
  blocks: TextBlock[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", thinsp: " " };

/**
 * Markup from the API as plain text: comments, script and style bodies and every tag dropped, the common named entities and
 * numeric entities decoded, whitespace collapsed. The result is only ever rendered as a text node.
 */
export function toPlainText(input: string): string {
  return input
    .slice(0, MAX_SEGMENT * 2)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?[a-z!?][^>]*>/gi, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEGMENT);
}

/** The first `n` non-empty segments of a version's text (a string, or nested arrays for a spanning ref). */
function firstSegments(text: unknown, n: number): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (out.length >= n) return;
    if (typeof x === "string") {
      const t = toPlainText(x);
      if (t) out.push(t);
    } else if (Array.isArray(x)) for (const y of x) walk(y);
  };
  walk(text);
  return out;
}

/** The answer as a card shows it: the first Hebrew and the first English version, `segments` segments each. */
export function toSourceText(answer: TextAnswer, segments = 2): SourceTextData {
  const blocks: TextBlock[] = [];
  for (const lang of ["he", "en"] as const) {
    const v = answer.versions.find((x) => x.language === lang);
    if (!v) continue;
    const segs = firstSegments(v.text, segments);
    if (segs.length) blocks.push({ lang, dir: v.direction ?? (lang === "he" ? "rtl" : "ltr"), segments: segs });
  }
  const text = (s: string | undefined) => (s ? toPlainText(s) || null : null);
  return {
    ref: toPlainText(answer.ref),
    heRef: text(answer.heRef),
    title: text(answer.indexTitle) ?? text(answer.title),
    blocks,
  };
}

export type TextFetch = (url: string) => Promise<Response>;

export interface TextSource {
  /** The ref's text (cached per ref); rejects when the request fails or the answer is not a text. */
  get(ref: string): Promise<SourceTextData>;
  /** Start fetching a ref without waiting (prefetch). */
  prefetch(ref: string): void;
  /** The ref's names if its answer has landed (for the stream's summary); null otherwise. Starts no request. */
  titles(ref: string): { heRef: string | null; title: string | null } | null;
  /** Fires when any answer lands. */
  subscribe(cb: () => void): () => void;
  /** How many requests were sent, per ref (tests). */
  requests(): Record<string, number>;
}

/** A per-page source of texts: one request per ref while its answer is cached; failures are forgotten so a retry can work. */
export function createTextSource(opts: { origin?: string; fetch?: TextFetch; segments?: number } = {}): TextSource {
  const cache = new Map<string, Promise<SourceTextData>>();
  const landed = new Map<string, SourceTextData>();
  const counts: Record<string, number> = {};
  const listeners = new Set<() => void>();
  const doFetch: TextFetch = opts.fetch ?? ((url) => fetch(url, { credentials: "omit" }));

  const get = (ref: string): Promise<SourceTextData> => {
    const hit = cache.get(ref);
    if (hit) return hit;
    counts[ref] = (counts[ref] ?? 0) + 1;
    const p = (async () => {
      const res = await doFetch(textUrl(ref, opts.origin));
      if (!res.ok) throw new Error(`text API answered ${res.status}`);
      const parsed = TextAnswer.safeParse(await res.json());
      if (!parsed.success) throw new Error("text API answer is not a text");
      return toSourceText(parsed.data, opts.segments ?? 2);
    })();
    cache.set(ref, p);
    p.then(
      (data) => {
        landed.set(ref, data);
        [...listeners].forEach((cb) => cb());
      },
      () => cache.delete(ref),
    );
    return p;
  };

  return {
    get,
    prefetch: (ref) => void get(ref).catch(() => undefined),
    titles(ref) {
      const d = landed.get(ref);
      return d ? { heRef: d.heRef, title: d.title } : null;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    requests: () => ({ ...counts }),
  };
}

let pageSource: TextSource | null = null;

/** The page's one text source (the surface and the publisher share it, so a ref is fetched once). */
export function pageTextSource(): TextSource {
  pageSource ??= createTextSource();
  return pageSource;
}
