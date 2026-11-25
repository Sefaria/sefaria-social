// The replay controller (spec 042, AC-006 and AC-008; design docs/design/session-recording-and-broadcast.md section 5). One per
// host, like the call controller. `open` loads a recording's metadata, its state track (parsed with the session schema) and its
// media (one Blob with progress, its WebM duration fixed so seeking works, played from an object URL), then hands the media
// element and the track to the player. Loading never touches the reader: on any failure the view says why and the reader stays
// where it was. `close` stops the media, frees the object URL and drops `ctx=social.rec.<id>` from the reader's address,
// leaving the reader where it is. `fromContext` opens, paused at the start, the recording a loaded address names.
//
//   closed → open(id) → loading { progress } → ready { player } ─ close() → closed
//                                    └→ error { not-found | invalid | failed } ─ close() → closed
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { ID_RE } from "~/lib/ids";
import { withoutAnyCtx } from "~/features/session/room-reader";
import { createReplayPlayer, type ReplayMedia, type ReplayPlayer, type ReplayPlayerView } from "./player";
import { createReplayApi, ReplayApiError, type ReplayApi } from "./replay-api";
import { InvalidRecordingError, parseStateTrack, type Chapter, type Recording } from "./state-track";
import { documentHostFor } from "~/features/host/document-host";

export type ReplayErrorReason = "not-found" | "invalid" | "failed";

export interface ReplayAsset {
  chapters: Chapter[];
  /** False for an audio-only recording (the leader's camera was never on, D13); true when not known. */
  hasVideo: boolean;
  track: Recording;
}

export type ReplayView =
  | { kind: "closed" }
  /** `progress` is 0–1, or null while the size is unknown. */
  | { kind: "loading"; recordingId: string; progress: number | null }
  | { kind: "ready"; recordingId: string; player: ReplayPlayerView }
  | { kind: "error"; recordingId: string; reason: ReplayErrorReason };

/** The media element the controller creates: the player's clock, plus what it needs to play from a URL. */
export interface ReplayMediaElement extends ReplayMedia {
  src: string;
  playsInline: boolean;
  muted: boolean;
  preload: string;
}

export interface ReplayDeps {
  host: SurfaceHost;
  api: ReplayApi;
  createMedia?: () => ReplayMediaElement;
  /**
   * Writes the recorded duration into a WebM's header so the browser can seek it (MediaRecorder leaves it out). The default
   * returns the blob unchanged; the surface passes `fix-webm-duration` here.
   */
  fixDuration?: (blob: Blob, durationMs: number) => Promise<Blob>;
  objectUrls?: { create(blob: Blob): string; revoke(url: string): void };
}

export interface ReplayController {
  view(): ReplayView;
  subscribe(cb: () => void): () => void;
  open(recordingId: string, opts?: { autoplay?: boolean }): Promise<void>;
  close(): void;
  /** The player while ready (transport controls), else null. */
  player(): ReplayPlayer | null;
  /** The element the window shows while ready, else null. */
  mediaElement(): ReplayMediaElement | null;
  /** Spec 053: the open recording's chapters, whether it has video, and its timeline (for the talking head's place). */
  asset(): ReplayAsset | null;
  /** Opens (paused at the start) the recording the reader's `ctx` names, if it names one. */
  fromContext(): void;
}

const REC_PREFIX = "social.rec.";

/** The reader context value for a recording's replay. */
export function recordingCtx(recordingId: string): string {
  if (!ID_RE.test(recordingId)) throw new Error("not a recording id");
  return `${REC_PREFIX}${recordingId}`;
}

/** The recording id in a ctx value `social.rec.<id>`, or null. */
export function readRecordingCtx(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(REC_PREFIX)) return null;
  const id = value.slice(REC_PREFIX.length);
  return ID_RE.test(id) ? id : null;
}

const defaultCreateMedia = (): ReplayMediaElement => document.createElement("video");
const defaultUrls = { create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u) };

function reasonOf(error: unknown): ReplayErrorReason {
  if (error instanceof InvalidRecordingError) return "invalid";
  if (error instanceof ReplayApiError && (error.status === 404 || error.status === 403 || error.status === 400))
    return "not-found";
  return "failed";
}

/**
 * MediaRecorder writes WebM without a duration or cues, so a browser cannot seek in it. Writing the recorded duration into
 * its header makes the scrubber work (fix-webm-duration, loaded only when a WebM recording is played). Anything else, or a
 * failure, plays as it is.
 */
export async function fixWebmDurationOf(blob: Blob, durationMs: number): Promise<Blob> {
  if (!/webm/i.test(blob.type) || !(durationMs > 0)) return blob;
  try {
    const { default: fix } = await import("fix-webm-duration");
    return await fix(blob, durationMs, { logger: false });
  } catch {
    return blob;
  }
}

export function createReplayController({
  host,
  api,
  createMedia = defaultCreateMedia,
  fixDuration = fixWebmDurationOf,
  objectUrls = defaultUrls,
}: ReplayDeps): ReplayController {
  const listeners = new Set<() => void>();
  let state: ReplayView = { kind: "closed" };
  let cached: ReplayView | null = null;
  /** Bumped by every open and close: a load that finds it changed was abandoned. */
  let generation = 0;
  let current: {
    player: ReplayPlayer;
    media: ReplayMediaElement;
    url: string;
    offPlayer: () => void;
    asset: ReplayAsset;
  } | null = null;

  const emit = () => {
    cached = null;
    for (const cb of [...listeners]) cb();
  };
  const set = (next: ReplayView) => {
    state = next;
    emit();
  };

  const release = () => {
    if (!current) return;
    const { player, media, url, offPlayer } = current;
    current = null;
    offPlayer();
    player.dispose();
    media.pause();
    media.src = "";
    objectUrls.revoke(url);
  };

  const controller: ReplayController = {
    view() {
      if (!cached) cached = state.kind === "ready" && current ? { ...state, player: current.player.view() } : state;
      return cached;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async open(recordingId, opts = {}) {
      if (state.kind !== "closed" && state.kind !== "error" && state.recordingId === recordingId) return;
      release();
      const mine = ++generation;
      const live = () => mine === generation;
      set({ kind: "loading", recordingId, progress: null });
      try {
        const meta = await api.getRecording(recordingId);
        if (!live()) return;
        const track = parseStateTrack(await api.getState(recordingId));
        if (!live()) return;
        // Spec 053: chapters and whether there is video, once the recording is processed (spec 052); none before.
        const manifest = api.getManifest ? await api.getManifest(recordingId).catch(() => null) : null;
        if (!live()) return;
        const raw = await api.getMedia(recordingId, {
          expectedBytes: meta.mediaBytes ?? undefined,
          onProgress: (loaded, total) => {
            if (live()) set({ kind: "loading", recordingId, progress: total ? Math.min(1, loaded / total) : null });
          },
        });
        if (!live()) return;
        // A processed file already knows its duration (spec 052); a raw MediaRecorder file needs it written in.
        const blob = manifest ? raw : await fixDuration(raw, meta.durationMs ?? track.duration);
        if (!live()) return;
        const url = objectUrls.create(blob);
        const media = createMedia();
        media.playsInline = true;
        media.muted = false;
        media.preload = "auto";
        media.src = url;
        const player = createReplayPlayer({ media, track, state: host.reader.state });
        const offPlayer = player.subscribe(emit);
        const asset: ReplayAsset = {
          chapters: (manifest?.chapters ?? []).map((c) => ({ t: c.t, ref: c.ref, heRef: c.heRef ?? null })),
          hasVideo: manifest?.hasVideo ?? true,
          track,
        };
        current = { player, media, url, offPlayer, asset };
        set({ kind: "ready", recordingId, player: player.view() });
        if (opts.autoplay) await player.play().catch(() => undefined);
      } catch (error) {
        if (!live()) return;
        const reason = reasonOf(error);
        host.report({ kind: "error", name: "replay-load-failed", data: { reason } });
        set({ kind: "error", recordingId, reason });
      }
    },
    close() {
      if (state.kind === "closed") return;
      generation++;
      release();
      set({ kind: "closed" });
      // Drop our context, and only ours; the reader stays where it is.
      if (readRecordingCtx(host.reader.context.get()) !== null) {
        const { pathname, search, hash } = host.location.get();
        host.navigate(withoutAnyCtx(`${pathname}${search}${hash}`), { replace: true });
      }
    },
    player: () => current?.player ?? null,
    mediaElement: () => current?.media ?? null,
    asset: () => current?.asset ?? null,
    fromContext() {
      const id = readRecordingCtx(host.reader.context.get());
      if (id) void controller.open(id, { autoplay: false });
    },
  };
  return controller;
}

const perHost = new WeakMap<SurfaceHost, ReplayController>();

/**
 * The replay controller for this host. The first call creates it; `overrides` (tests, the surface's `fix-webm-duration`) are
 * ignored once it exists.
 */
export function replayControllerFor(rawHost: SurfaceHost, overrides: Partial<Omit<ReplayDeps, "host">> = {}): ReplayController {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let c = perHost.get(host);
  if (!c) {
    c = createReplayController({ ...overrides, host, api: overrides.api ?? createReplayApi(host) });
    perHost.set(host, c);
  }
  return c;
}
