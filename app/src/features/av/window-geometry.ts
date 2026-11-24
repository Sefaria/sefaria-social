// The call window's geometry (spec 035; design docs/design/audio-video.md 6.2), as pure functions in CSS pixels. Corners are
// logical (start/end), so the Hebrew interface mirrors the English one; arrows and boxes are physical. The window lives in
// the area left by the reader's chrome (insets from spec 036, or the fallback in ./insets.ts).
import { z } from "zod";

export type Corner = "top-start" | "top-end" | "bottom-start" | "bottom-end";
export type SizeName = "pill" | "small" | "medium" | "large" | "custom";
export type Dir = "ltr" | "rtl";

export interface Placement {
  v: 1;
  corner: Corner;
  /** Distance from the corner's side edge (start or end) of the area. */
  offsetX: number;
  /** Distance from the corner's top or bottom edge of the area. */
  offsetY: number;
  size: SizeName;
  /** The width chosen by resizing (size "custom"); null for the presets. */
  width: number | null;
}

export interface Insets {
  top: number;
  inlineStart: number;
  inlineEnd: number;
  bottom: number;
}
export interface Viewport {
  width: number;
  height: number;
}
/** Physical edges of the area the window may use. */
export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MARGIN = 16;
/** The controls bar under the tiles (and the handle above them). */
export const CONTROLS_HEIGHT = 48;
const RATIO = 10 / 16; // tile area height / width
const SMALL_WIDTH = 320;
const MEDIUM_WIDTH = 480;
const PILL = { width: 240, height: 48 };
const LARGE_SHARE = 0.6;

export const DEFAULT_PLACEMENT: Placement = {
  v: 1,
  corner: "top-end",
  offsetX: MARGIN,
  offsetY: MARGIN,
  size: "small",
  width: null,
};

export const STORAGE_KEY = "sefaria-social.call-window";

export function area(viewport: Viewport, insets: Insets, dir: Dir): Area {
  const leftInset = dir === "ltr" ? insets.inlineStart : insets.inlineEnd;
  const rightInset = dir === "ltr" ? insets.inlineEnd : insets.inlineStart;
  return { left: leftInset, top: insets.top, right: viewport.width - rightInset, bottom: viewport.height - insets.bottom };
}

const boxFor = (width: number) => ({ width: Math.round(width), height: Math.round(width * RATIO) + CONTROLS_HEIGHT });

/** The largest window: at most 60 % of the viewport in each dimension, tile area 16:10, never smaller than small. */
function largeWidth(viewport: Viewport): number {
  const byWidth = viewport.width * LARGE_SHARE;
  const byHeight = (viewport.height * LARGE_SHARE - CONTROLS_HEIGHT) / RATIO;
  return Math.max(SMALL_WIDTH, Math.floor(Math.min(byWidth, byHeight)));
}

export function dimensions(p: Pick<Placement, "size" | "width">, viewport: Viewport): { width: number; height: number } {
  switch (p.size) {
    case "pill":
      return { ...PILL };
    case "small":
      return boxFor(SMALL_WIDTH);
    case "medium":
      return boxFor(Math.min(MEDIUM_WIDTH, largeWidth(viewport)));
    case "large":
      return boxFor(largeWidth(viewport));
    case "custom":
      return boxFor(Math.min(largeWidth(viewport), Math.max(SMALL_WIDTH, p.width ?? SMALL_WIDTH)));
  }
}

/** Is the corner's side the physical left? */
const onLeft = (corner: Corner, dir: Dir) => corner.endsWith("start") === (dir === "ltr");
const onTop = (corner: Corner) => corner.startsWith("top");

const clamp = (v: number, min: number, max: number) => (max < min ? min : Math.min(Math.max(v, min), max));

/** The window's box for a placement, clamped inside the area (AC-006). */
export function rect(p: Placement, dims: { width: number; height: number }, a: Area, dir: Dir): Box {
  const left = onLeft(p.corner, dir) ? a.left + p.offsetX : a.right - p.offsetX - dims.width;
  const top = onTop(p.corner) ? a.top + p.offsetY : a.bottom - p.offsetY - dims.height;
  return {
    left: clamp(left, a.left, a.right - dims.width),
    top: clamp(top, a.top, a.bottom - dims.height),
    width: dims.width,
    height: dims.height,
  };
}

/** The placement that puts `box` where it is, measured from `corner`. */
export function fromBox(p: Placement, box: Box, corner: Corner, a: Area, dir: Dir): Placement {
  const left = clamp(box.left, a.left, a.right - box.width);
  const top = clamp(box.top, a.top, a.bottom - box.height);
  const offsetX = onLeft(corner, dir) ? left - a.left : a.right - (left + box.width);
  const offsetY = onTop(corner) ? top - a.top : a.bottom - (top + box.height);
  return { ...p, corner, offsetX: Math.max(0, Math.round(offsetX)), offsetY: Math.max(0, Math.round(offsetY)) };
}

/** A released window goes to the corner nearest its centre, MARGIN inside the area (AC-004). */
export function snap(p: Placement, box: Box, a: Area, dir: Dir): Placement {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const left = cx < (a.left + a.right) / 2;
  const top = cy < (a.top + a.bottom) / 2;
  const side = left === (dir === "ltr") ? "start" : "end";
  return { ...p, corner: `${top ? "top" : "bottom"}-${side}`, offsetX: MARGIN, offsetY: MARGIN };
}

/** A keyboard move by physical pixels, keeping the corner (AC-008). */
export function nudge(
  p: Placement,
  dx: number,
  dy: number,
  dims: { width: number; height: number },
  a: Area,
  dir: Dir,
): Placement {
  const r = rect(p, dims, a, dir);
  return fromBox(p, { ...r, left: r.left + dx, top: r.top + dy }, p.corner, a, dir);
}

const Saved = z.strictObject({
  v: z.literal(1),
  corner: z.enum(["top-start", "top-end", "bottom-start", "bottom-end"]),
  offsetX: z.number().finite().min(0).max(10_000),
  offsetY: z.number().finite().min(0).max(10_000),
  size: z.enum(["pill", "small", "medium", "large", "custom"]),
  width: z.number().finite().min(0).max(10_000).nullable(),
});

type Read = { getItem(key: string): string | null } | null;
type Write = { setItem(key: string, value: string): void } | null;

/** The saved place, or the default when there is none, storage throws, or the value is not valid (AC-007). */
export function loadPlacement(storage: Read): Placement {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLACEMENT;
    const parsed = Saved.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PLACEMENT;
  } catch {
    return DEFAULT_PLACEMENT;
  }
}

export function savePlacement(storage: Write, p: Placement): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // private window, blocked storage, quota: the default is used next time
  }
}

/** The browser's storage, or null where reading it throws. */
export function browserStorage(): (Storage & object) | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
