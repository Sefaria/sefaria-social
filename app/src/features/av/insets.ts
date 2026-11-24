// The parts of the viewport the reader's own chrome occupies (its header, an open side panel), for the call window (spec 035).
// Spec 036: read from SurfaceHost 1.2's `ui.chrome`, checked before use; an older reader, a bad value or a `get()` that throws
// gives the fallback, and a bad value is reported once per page.
import { useSyncExternalStore } from "react";
import { chromeInsetsSchema, type SurfaceHost } from "@sefaria-social/host-contract";
import { useHost } from "~/features/host/host-context";
import type { Insets } from "./window-geometry";

/** A reader that says nothing about its chrome: keep clear of a 64px header, nothing else (spec 036 AC-003). */
export const FALLBACK_INSETS: Insets = { top: 64, inlineStart: 0, inlineEnd: 0, bottom: 0 };

const reported = new WeakSet<SurfaceHost>();

/** The reader's insets now, or the fallback (reporting a bad value once per host). */
export function readChromeInsets(host: SurfaceHost | null): Insets {
  const chrome = host?.ui.chrome;
  if (!host || !chrome) return FALLBACK_INSETS;
  let ok: Insets | null = null;
  try {
    const parsed = chromeInsetsSchema.safeParse(chrome.get());
    const vw = typeof window === "undefined" ? Infinity : window.innerWidth;
    const vh = typeof window === "undefined" ? Infinity : window.innerHeight;
    if (parsed.success) {
      const v = parsed.data;
      if (v.top + v.bottom <= vh && v.inlineStart + v.inlineEnd <= vw) ok = v;
    }
  } catch {
    ok = null;
  }
  if (ok) return ok;
  if (!reported.has(host)) {
    reported.add(host);
    host.report({ kind: "error", name: "av.error", data: { kind: "chrome_invalid" } });
  }
  return FALLBACK_INSETS;
}

const noop = () => () => undefined;
const cache = new WeakMap<object, { key: string; value: Insets }>();
const FALLBACK_KEY = {};

/** The reader's insets, re-rendering when they change (spec 036 AC-002). */
export function useChromeInsets(): Insets {
  const host = useHost();
  const chrome = host?.ui.chrome;
  return useSyncExternalStore(
    chrome ? (cb) => chrome.subscribe(cb) : noop,
    () => {
      const value = readChromeInsets(host);
      // a stable object while the numbers are the same (useSyncExternalStore compares by identity)
      const owner = host ?? FALLBACK_KEY;
      const key = `${value.top},${value.inlineStart},${value.inlineEnd},${value.bottom}`;
      const had = cache.get(owner);
      if (had?.key === key) return had.value;
      cache.set(owner, { key, value });
      return value;
    },
    () => FALLBACK_INSETS,
  );
}
