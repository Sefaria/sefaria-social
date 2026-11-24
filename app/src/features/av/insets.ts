// The parts of the viewport the reader's own chrome occupies (its header, an open side panel), for the call window (spec
// 035). Spec 036 reads them from SurfaceHost 1.2's `ui.chrome`; until then, and with an older reader, the fallback below.
import type { Insets } from "./window-geometry";

/** A reader that says nothing about its chrome: keep clear of a 64px header, nothing else (spec 036 AC-003). */
export const FALLBACK_INSETS: Insets = { top: 64, inlineStart: 0, inlineEnd: 0, bottom: 0 };

/** The reader's insets now. */
export function useChromeInsets(): Insets {
  return FALLBACK_INSETS;
}
