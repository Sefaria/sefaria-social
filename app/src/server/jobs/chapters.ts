// The chapters of a shiur (spec 052 AC-003): where the leader's text changed, read from the recording's reader timeline. Each
// change of the leader's ref is a chapter {t, ref, heRef}; a place left within MERGE_MS is dropped (a skim through several texts
// on the way somewhere is one move). Also whether the leader's camera was ever on (the asset has video, D13).
import type { StreamMessage } from "@sefaria-social/session";

export const MERGE_MS = 3_000;
const SUMMARY = "social.summary";
const SCROLL = "sefaria.scroll";
const OVERLAY = "social.overlay";

export interface Chapter {
  t: number;
  ref: string;
  heRef: string | null;
}

type Slices = Record<string, { v: number; value: unknown } | null | undefined>;

function refOf(url: string, slices: Slices): { ref: string; heRef: string | null } | null {
  const summary = slices[SUMMARY]?.value as { ref?: unknown; heRef?: unknown } | undefined;
  if (typeof summary?.ref === "string" && summary.ref)
    return { ref: summary.ref, heRef: typeof summary.heRef === "string" ? summary.heRef : null };
  const scroll = slices[SCROLL]?.value;
  if (scroll && typeof scroll === "object")
    for (const a of Object.values(scroll as Record<string, { ref?: unknown }>))
      if (typeof a?.ref === "string" && a.ref) return { ref: a.ref, heRef: null };
  // The address alone, for a timeline without a summary: only a text's address (Genesis.1), never a malformed one or a page
  // that is not a text (topics, search), which would otherwise become a chapter or fail the whole processing.
  const path = url.split(/[?#]/)[0]!.replace(/^\/+/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!/^[A-Z][^/]*$/.test(decoded)) return null;
  return { ref: decoded.replace(/_/g, " ").replace(/\./g, " "), heRef: null };
}

export function chaptersOf(messages: readonly StreamMessage[]): { chapters: Chapter[]; hasVideo: boolean } {
  let url = "";
  let slices: Slices = {};
  let hasVideo = false;
  const raw: Chapter[] = [];
  for (const m of messages) {
    if (m.type === "keyframe") {
      url = m.snapshot.url;
      slices = { ...(m.snapshot.slices as Slices) };
    } else {
      if (m.change.url !== undefined) url = m.change.url;
      if (m.change.slices) for (const [id, v] of Object.entries(m.change.slices)) slices[id] = v as Slices[string];
    }
    if ((slices[OVERLAY]?.value as { camera?: unknown } | undefined)?.camera === true) hasVideo = true;
    const here = refOf(url, slices);
    if (!here) continue;
    if (raw.at(-1)?.ref === here.ref) continue;
    raw.push({ t: Math.max(0, Math.round(m.t)), ...here });
  }
  // A place the leader left within MERGE_MS was passed through on the way: it is not a chapter. The last place always is.
  const kept = raw.filter((c, i) => i === raw.length - 1 || raw[i + 1]!.t - c.t >= MERGE_MS);
  const chapters = kept.filter((c, i) => i === 0 || kept[i - 1]!.ref !== c.ref);
  return { chapters, hasVideo };
}
