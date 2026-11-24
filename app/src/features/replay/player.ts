// The replay player (spec 042, AC-003 – AC-005; design docs/design/session-recording-and-broadcast.md section 5). The media
// element is the clock: t = currentTime × 1000. On `timeupdate`, `seeked`, `play` and a 250 ms timer while playing, the player
// computes the recorded reader state at t and, when that point differs from the last one applied and the reader is following,
// applies it through the reader state API with origin "playback" and without persisting. One apply is in flight at a time;
// requests that arrive meanwhile collapse into the latest, applied when the current one settles.
//
// Local input in the reader (not our own apply) detaches it: the media keeps playing and nothing more is applied until
// `rejoin()`, which applies the current point at once. Pause, seek, skip and speed act on the media; the reader follows from the
// media's own events, so the two stay together.
import type { ReaderStateApi } from "@sefaria-social/host-contract";
import { keyframeTimes, snapshotAt, type Recording } from "./state-track";

/** How often the player checks the clock while playing, between `timeupdate`s (ms). */
export const TICK_MS = 250;
/** The speeds the transport offers. */
export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

type MediaEvent = "timeupdate" | "seeked" | "play" | "pause" | "ended" | "ratechange";

/** What the player needs of an HTMLMediaElement (tests give a fake). */
export interface ReplayMedia {
  currentTime: number;
  /** Seconds; NaN or Infinity until known. */
  readonly duration: number;
  readonly paused: boolean;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: MediaEvent, listener: () => void): void;
  removeEventListener(type: MediaEvent, listener: () => void): void;
}

export interface ReplayPlayerView {
  playing: boolean;
  /** ms */
  t: number;
  /** ms */
  duration: number;
  rate: Rate;
  /** False after local input in the reader, until `rejoin()`. */
  following: boolean;
  /** ms, the scrubber's ticks. */
  keyframes: number[];
}

export interface ReplayPlayer {
  view(): ReplayPlayerView;
  subscribe(cb: () => void): () => void;
  play(): Promise<void>;
  pause(): void;
  /** Seek to `ms`, clamped to [0, duration]. */
  seek(ms: number): void;
  skip(deltaMs: number): void;
  setRate(rate: Rate): void;
  /** Follow the recording again and apply its current point now. */
  rejoin(): void;
  dispose(): void;
}

export interface ReplayPlayerDeps {
  media: ReplayMedia;
  track: Recording;
  state: Pick<ReaderStateApi, "applySnapshot" | "onLocalInput" | "applying">;
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

const MEDIA_EVENTS: MediaEvent[] = ["timeupdate", "seeked", "play", "pause", "ended", "ratechange"];

export function createReplayPlayer({
  media,
  track,
  state,
  setInterval: startTimer = (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: stopTimer = (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
}: ReplayPlayerDeps): ReplayPlayer {
  const keyframes = keyframeTimes(track);
  const listeners = new Set<() => void>();
  let following = true;
  let disposed = false;
  let lastKey: string | null = null;
  let inFlight = false;
  let pending: { snapshot: ReturnType<typeof snapshotAt>["snapshot"]; key: string } | null = null;
  let timer: unknown = null;
  let cached: ReplayPlayerView | null = null;

  const durationMs = () => {
    const d = media.duration;
    return Number.isFinite(d) && d > 0 ? d * 1000 : track.duration;
  };
  const nowMs = () => Math.max(0, media.currentTime * 1000);
  const rateOf = (r: number): Rate => RATES.find((x) => x === r) ?? 1;

  const emit = () => {
    cached = null;
    for (const cb of [...listeners]) cb();
  };

  const run = (point: { snapshot: ReturnType<typeof snapshotAt>["snapshot"]; key: string }) => {
    inFlight = true;
    lastKey = point.key;
    void state
      .applySnapshot(point.snapshot, { origin: "playback", persist: false })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        const next = pending;
        pending = null;
        if (!disposed && following && next && next.key !== lastKey) run(next);
      });
  };

  /** Applies the point at the media's time when it is not the one last applied. */
  const sync = () => {
    if (disposed || !following) return;
    const point = snapshotAt(track, nowMs());
    if (inFlight) {
      pending = point;
      return;
    }
    if (point.key === lastKey) return;
    run(point);
  };

  const seek = (ms: number) => {
    if (disposed) return;
    const clamped = Math.min(Math.max(0, ms), durationMs());
    media.currentTime = clamped / 1000;
    // The media fires `seeked`; syncing now as well keeps the reader with it where seeking is instant and silent.
    sync();
    emit();
  };

  const startTicking = () => {
    if (timer === null) timer = startTimer(() => sync(), TICK_MS);
  };
  const stopTicking = () => {
    if (timer !== null) stopTimer(timer);
    timer = null;
  };

  const handlers: Record<MediaEvent, () => void> = {
    timeupdate: () => {
      sync();
      emit();
    },
    seeked: () => {
      sync();
      emit();
    },
    play: () => {
      startTicking();
      sync();
      emit();
    },
    pause: () => {
      stopTicking();
      emit();
    },
    ended: () => {
      stopTicking();
      sync();
      emit();
    },
    ratechange: emit,
  };
  for (const type of MEDIA_EVENTS) media.addEventListener(type, handlers[type]);
  if (!media.paused) startTicking();

  const offInput = state.onLocalInput(() => {
    if (state.applying || !following) return; // our own apply's input is not the person's
    following = false;
    pending = null;
    lastKey = null; // the reader is elsewhere now: rejoining applies the current point even if it is the last one applied
    emit();
  });

  // The reader starts at the recording's point for the media's current time (0 on open).
  sync();

  return {
    view() {
      cached ??= {
        playing: !media.paused,
        t: Math.min(nowMs(), durationMs()),
        duration: durationMs(),
        rate: rateOf(media.playbackRate),
        following,
        keyframes,
      };
      return cached;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async play() {
      if (disposed) return;
      await media.play();
    },
    pause() {
      if (!disposed) media.pause();
    },
    seek,
    skip(deltaMs) {
      seek(nowMs() + deltaMs);
    },
    setRate(rate) {
      if (disposed) return;
      media.playbackRate = rate;
      emit();
    },
    rejoin() {
      if (disposed) return;
      following = true;
      lastKey = null;
      sync();
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTicking();
      offInput();
      for (const type of MEDIA_EVENTS) media.removeEventListener(type, handlers[type]);
      pending = null;
      listeners.clear();
    },
  };
}
