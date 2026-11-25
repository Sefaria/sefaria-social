// Where a reader is, for sticky following (spec 048 AC-001..AC-003). The session client asks, once a follower's reader has
// been still for a moment after their input, whether they are clearly away from the person they follow; only then does it
// set them on their own. "Clearly away" is the owner's rule (docs/plans/shiur.md D7): another book or section, or 5 or more
// segments apart in the same section. A click, a scroll of a few lines, a side panel, or anything on Social's own windows is
// not away.
import type { ReaderSnapshot } from "@sefaria-social/session";
import { SUMMARY_SLICE } from "./room-reader";

/** reader-next's moment slice of each panel's reading-line anchor: `{ [panelKey]: { ref, offset } }`. */
const SCROLL_SLICE = "sefaria.scroll";
/** Spec 048 AC-003. */
export const AWAY_SEGMENTS = 5;

export interface Place {
  /** The ref without its last segment number: "Genesis 1", "Berakhot 2a", "Rashi on Genesis 1:1". */
  section: string;
  /** The segment number, when the ref names one. */
  segment: number | null;
}

/** "Genesis 1:5" → {Genesis 1, 5}; "Genesis 1:5-8" and "Genesis 1:5-2:3" start at 5; "Genesis 1" → {Genesis 1, null}. */
export function placeOfRef(ref: string): Place | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  // A range ends in "-" and numbers, colons or daf sides: keep where it starts.
  const start = trimmed.replace(/-[\d:ab]+$/, "");
  const colon = start.lastIndexOf(":");
  if (colon < 0) return { section: start, segment: null };
  const segment = Number(start.slice(colon + 1));
  if (!Number.isInteger(segment)) return { section: start, segment: null };
  return { section: start.slice(0, colon), segment };
}

function firstAnchorRef(snapshot: ReaderSnapshot): string | null {
  const value = snapshot.slices[SCROLL_SLICE]?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const anchor of Object.values(value as Record<string, unknown>)) {
    const ref = (anchor as { ref?: unknown } | null)?.ref;
    if (typeof ref === "string" && ref) return ref;
  }
  return null;
}

function summaryRef(snapshot: ReaderSnapshot): string | null {
  const ref = (snapshot.slices[SUMMARY_SLICE]?.value as { ref?: unknown } | undefined)?.ref;
  return typeof ref === "string" && ref ? ref : null;
}

/** The reader's place: the first panel's anchor, else the summary's ref; null when the snapshot names neither. */
export function placeOf(snapshot: ReaderSnapshot): Place | null {
  const ref = firstAnchorRef(snapshot) ?? summaryRef(snapshot);
  return ref ? placeOfRef(ref) : null;
}

const pathOf = (url: string) => url.split(/[?#]/)[0] ?? url;

/** Is `mine` clearly away from `theirs`? (the session client's `drifted`) */
export function drifted(mine: ReaderSnapshot, theirs: ReaderSnapshot): boolean {
  const a = placeOf(mine);
  const b = placeOf(theirs);
  if (!a || !b) return pathOf(mine.url) !== pathOf(theirs.url);
  if (a.section !== b.section) return true;
  if (a.segment === null || b.segment === null) return false;
  return Math.abs(a.segment - b.segment) >= AWAY_SEGMENTS;
}
