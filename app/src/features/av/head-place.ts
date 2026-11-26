// Where the viewer's talking head is on screen (spec 051 AC-003): the call window's box as fractions of the viewport, kept up to
// date by the window while it shows and null while it does not. A recording keeps it in its timeline, so a replay can put the
// head back where the leader had it (spec 053). Module state, one per page: there is one call window per page.

export interface HeadPlace {
  x: number;
  y: number;
  w: number;
  h: number;
}

let current: HeadPlace | null = null;
const listeners = new Set<() => void>();

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

/** The call window's box in CSS pixels and the viewport's size; null when the window is not shown. */
export function setHeadPlace(
  box: { left: number; top: number; width: number; height: number } | null,
  viewport?: {
    width: number;
    height: number;
  },
): void {
  const next =
    box && viewport && viewport.width > 0 && viewport.height > 0
      ? {
          x: round(box.left / viewport.width),
          y: round(box.top / viewport.height),
          w: round(box.width / viewport.width),
          h: round(box.height / viewport.height),
        }
      : null;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const cb of [...listeners]) cb();
}

export const headPlace = (): HeadPlace | null => current;

export function onHeadPlace(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
