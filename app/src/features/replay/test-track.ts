// Test helpers for replay: a recorded state track as the server returns it, a fake media element that is its own clock, and
// a fake reader state API whose applies settle when the test says so.

const snap = (url: string, scroll = 0) => ({
  v: 1,
  url,
  nav: null,
  slices: { "sefaria.scroll": { v: 1, value: { y: scroll } } },
});

/**
 * A 20 s recording: Genesis 1 from 0, a change to Genesis 2 at 4 s and a scroll at 6 s, a keyframe (Genesis 2) at 10 s, a change
 * to Exodus 1 at 12 s.
 */
export function trackJson(): Record<string, unknown> {
  return {
    v: 1,
    startedAt: "2026-11-01T10:00:00.000Z",
    duration: 20_000,
    messages: [
      { type: "keyframe", seq: 0, t: 0, snapshot: snap("/Genesis.1") },
      { type: "change", seq: 1, t: 4_000, change: { url: "/Genesis.2" } },
      { type: "change", seq: 2, t: 6_000, change: { slices: { "sefaria.scroll": { v: 1, value: { y: 300 } } } } },
      { type: "keyframe", seq: 3, t: 10_000, snapshot: snap("/Genesis.2", 300) },
      { type: "change", seq: 4, t: 12_000, change: { url: "/Exodus.1" } },
    ],
  };
}

type Listener = () => void;

/** A media element whose clock moves only when the test advances it. Seeking fires `seeked`, like a browser. */
export function createFakeMedia(durationSeconds = 20) {
  const listeners = new Map<string, Set<Listener>>();
  let time = 0;
  const fire = (type: string) => listeners.get(type)?.forEach((l) => l());
  const media = {
    duration: durationSeconds,
    paused: true,
    playbackRate: 1,
    src: "",
    playsInline: false,
    muted: true,
    preload: "none",
    get currentTime() {
      return time;
    },
    set currentTime(s: number) {
      time = s;
      fire("seeked");
    },
    async play() {
      media.paused = false;
      fire("play");
    },
    pause() {
      if (media.paused) return;
      media.paused = true;
      fire("pause");
    },
    addEventListener(type: string, l: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
    },
    removeEventListener(type: string, l: Listener) {
      listeners.get(type)?.delete(l);
    },
    /** Plays `seconds` of wall time at the current rate, then fires `timeupdate`. */
    advance(seconds: number) {
      if (media.paused) return;
      time = Math.min(media.duration, time + seconds * media.playbackRate);
      fire("timeupdate");
    },
    /** Moves the clock without any event (a browser that throttles `timeupdate`). */
    drift(seconds: number) {
      time = Math.min(media.duration, time + seconds * media.playbackRate);
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return media;
}

interface Applied {
  snapshot: { url: string; slices: Record<string, unknown> };
  ctx: { origin: string; persist: boolean };
}

/** A reader state API that records applies; with `manual`, each apply stays in flight until `settle()`. */
export function createFakeState(opts: { manual?: boolean } = {}) {
  const applied: Applied[] = [];
  const waiting: (() => void)[] = [];
  const inputs = new Set<() => void>();
  const state = {
    applied,
    applying: false,
    async applySnapshot(snapshot: Applied["snapshot"], ctx: Applied["ctx"]) {
      applied.push({ snapshot, ctx });
      state.applying = true;
      if (opts.manual) await new Promise<void>((resolve) => waiting.push(resolve));
      state.applying = false;
      return { warnings: [] };
    },
    onLocalInput(cb: () => void) {
      inputs.add(cb);
      return () => void inputs.delete(cb);
    },
    /** The person's input in the reader. */
    input() {
      inputs.forEach((cb) => cb());
    },
    /** Settles the oldest apply in flight. */
    async settle() {
      waiting.shift()?.();
      await flush();
    },
    inFlight: () => waiting.length,
    urls: () => applied.map((a) => a.snapshot.url),
  };
  return state;
}

/** Lets promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
