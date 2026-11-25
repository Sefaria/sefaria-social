// The recording controller (spec 041; design docs/design/session-recording-and-broadcast.md 4). One per host, like the call
// controller: the owner starts a recording of a room from the lobby or the call window, and it keeps running across every
// navigation until they stop it or an upload fails for good.
//
//   start(roomId) → POST rooms/:id/recordings → mixer (the call's audioTracks, re-fed on every change) + compositor (the
//   registered tiles, the call's participants, else the room's title card) + the room's outgoing reader view → recorder
//   stop() → recorder.stop (last chunk, final keyframe, finish) → idle
//
// Reports carry durations and error kinds only: never ids, names or tokens.
import type { SurfaceHost } from "@sefaria-social/host-contract";
import type { ReaderStateApi } from "@sefaria-social/session";
import { roomsApiFor } from "~/features/api/rooms-api";
import { callControllerFor } from "~/features/av/call-controller";
import type { CallMedia, CallParticipant } from "~/features/av/media";
import { tileVideos } from "~/features/av/tile-registry";
import { roomReader } from "~/features/session/room-reader";
import { stringsFor } from "~/features/shell/strings";
import { pageTextSource } from "~/lib/sefaria-text";
import { createCompositor, type Compositor, type CompositorOptions } from "./compositor";
import { createMixer, type Mixer } from "./mixer";
import { createSessionRecorder, pickMimeType, type SessionRecorder, type SessionRecorderOptions } from "./recorder";
import { recordingApiFor, type RecordingApi } from "./recording-api";
import { documentHostFor } from "~/features/host/document-host";

export type RecordingFailure = "upload" | "unavailable" | "already-recording" | "forbidden" | "error";

export type RecordingView =
  | { kind: "idle" }
  | { kind: "starting"; roomId: string }
  | { kind: "recording"; roomId: string; since: number; paused?: true }
  | { kind: "stopping"; roomId: string }
  | { kind: "failed"; roomId: string; reason: RecordingFailure };

export interface RecordingController {
  view(): RecordingView;
  subscribe(cb: () => void): () => void;
  start(roomId: string): Promise<void>;
  stop(): Promise<void>;
  /** Spec 050 AC-001: pause the recording (the paused time is cut); resume goes on in the same recording. */
  pause(): void;
  resume(): void;
  /** The recorded time so far in ms, paused time left out; 0 when not recording. */
  elapsed(): number;
  /** Clear a failure (the owner read it). */
  dismiss(): void;
  dispose(): void;
}

/** The call as the recorder needs it. */
export interface RecordingCall {
  media(): CallMedia | null;
  subscribe(cb: () => void): () => void;
}

export interface RecordingDeps {
  host: SurfaceHost;
  api: Pick<RecordingApi, "start" | "putMedia" | "putState" | "finish">;
  call: RecordingCall;
  /** The room's title, for the card drawn when there is no call. */
  roomTitle(roomId: string): Promise<string>;
  /** The room's outgoing reader view (moment slices, no ctx). */
  reader(): ReaderStateApi;
  createMixer?: () => Mixer;
  createCompositor?: (opts: CompositorOptions) => Compositor;
  createRecorder?: (opts: SessionRecorderOptions) => SessionRecorder;
  now?: () => number;
}

/** The viewer first, then whoever is speaking, then everyone else (the tiles' order). */
const ordered = (ps: CallParticipant[]) =>
  ps
    .map((p, i) => ({ p, i, rank: p.local ? 0 : p.speaking ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ p }) => p);

export function createRecordingController(deps: RecordingDeps): RecordingController {
  const { host, api, call } = deps;
  const now = deps.now ?? (() => Date.now());
  let view: RecordingView = { kind: "idle" };
  const listeners = new Set<() => void>();
  let active: { recorder: SessionRecorder; mixer: Mixer; cleanup: () => void } | null = null;
  let generation = 0;

  const emit = () => [...listeners].forEach((cb) => cb());
  const set = (next: RecordingView) => {
    view = next;
    emit();
  };
  const report = (name: string, data: Record<string, string | number | boolean> = {}) =>
    host.report({ kind: name === "recording.error" ? "error" : "event", name, data });

  /** Feed the mixer from whatever call is connected now, and again on every change of it or its tracks. */
  function follow(mixer: Mixer): () => void {
    let media: CallMedia | null = null;
    let offMedia: (() => void) | null = null;
    const feed = () => mixer.setTracks(media?.audioTracks() ?? []);
    const sync = () => {
      const m = call.media();
      if (m !== media) {
        offMedia?.();
        media = m;
        offMedia = m ? m.subscribe(feed) : null;
      }
      feed();
    };
    const offCall = call.subscribe(sync);
    sync();
    return () => {
      offCall();
      offMedia?.();
    };
  }

  function release() {
    active?.cleanup();
    active = null;
  }

  const controller: RecordingController = {
    view: () => view,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },

    async start(roomId) {
      if (view.kind === "starting" || view.kind === "recording" || view.kind === "stopping") return;
      const gen = ++generation;
      set({ kind: "starting", roomId });
      let title = "";
      const titleLoaded = deps.roomTitle(roomId).then(
        (t) => void (title = t),
        () => undefined,
      );
      let id: string;
      try {
        const r = await api.start(roomId, pickMimeType());
        if (gen !== generation) return;
        if (r.kind !== "ok") {
          set({ kind: "failed", roomId, reason: r.kind });
          report("recording.error", { kind: `start_${r.kind}` });
          return;
        }
        id = r.id;
      } catch {
        if (gen !== generation) return;
        set({ kind: "failed", roomId, reason: "error" });
        report("recording.error", { kind: "start_network" });
        return;
      }
      await titleLoaded;
      if (gen !== generation) return;
      try {
        const strings = () => stringsFor(host.ui.interfaceLang);
        const mixer = (deps.createMixer ?? createMixer)();
        const unfollow = follow(mixer);
        const compositor = (deps.createCompositor ?? createCompositor)({
          tiles: tileVideos,
          participants: () => ordered(call.media()?.participants() ?? []),
          title: () => title,
          noCall: () => strings().noCall,
          someone: () => strings().someone,
        });
        const recorder = (deps.createRecorder ?? createSessionRecorder)({
          api,
          recordingId: id,
          reader: deps.reader(),
          mixer,
          compositor,
          onChange(status) {
            if (gen !== generation) return;
            if (status === "failed") {
              release();
              set({ kind: "failed", roomId, reason: "upload" });
              report("recording.error", { kind: "upload" });
            }
          },
        });
        active = {
          recorder,
          mixer,
          cleanup: () => {
            unfollow();
            compositor.stop();
            mixer.dispose();
          },
        };
        recorder.start();
        set({ kind: "recording", roomId, since: now() });
        report("recording.start");
      } catch {
        release();
        set({ kind: "failed", roomId, reason: "error" });
        report("recording.error", { kind: "recorder" });
      }
    },

    async stop() {
      if (view.kind !== "recording" || !active) return;
      const { roomId } = view;
      const gen = generation;
      const recorder = active.recorder;
      set({ kind: "stopping", roomId });
      await recorder.stop();
      if (gen !== generation) return;
      if (recorder.status() === "failed") return; // onChange already said so
      release();
      report("recording.stop", { durationS: Math.round(recorder.elapsed() / 1000) });
      set({ kind: "idle" });
    },

    pause() {
      if (view.kind !== "recording" || view.paused || !active?.recorder.pause) return;
      active.recorder.pause();
      set({ kind: "recording", roomId: view.roomId, since: view.since, paused: true });
      report("recording.pause");
    },

    resume() {
      if (view.kind !== "recording" || !view.paused || !active?.recorder.resume) return;
      active.recorder.resume();
      set({ kind: "recording", roomId: view.roomId, since: view.since });
      report("recording.resume");
    },

    elapsed: () => (view.kind === "recording" || view.kind === "stopping" ? (active?.recorder.elapsed() ?? 0) : 0),

    dismiss() {
      if (view.kind === "failed") set({ kind: "idle" });
    },

    dispose() {
      generation++;
      const a = active;
      if (a) void a.recorder.stop().finally(() => a.cleanup());
      active = null;
      listeners.clear();
    },
  };
  return controller;
}

const perHost = new WeakMap<SurfaceHost, RecordingController>();

/** The recording controller for this host. The first call creates it; `overrides` (tests) are ignored once it exists. */
export function recordingControllerFor(
  rawHost: SurfaceHost,
  overrides: Partial<Omit<RecordingDeps, "host">> = {},
): RecordingController {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let c = perHost.get(host);
  if (!c) {
    c = createRecordingController({
      host,
      api: overrides.api ?? recordingApiFor(host),
      call: overrides.call ?? callControllerFor(host),
      roomTitle:
        overrides.roomTitle ??
        (async (roomId) => {
          const r = await roomsApiFor(host).getRoom(roomId);
          return r.kind === "member" ? r.room.title : "";
        }),
      // A view of its own over the host's reader: it only reads (isOpen false), so it never applies anything.
      reader:
        overrides.reader ??
        (() =>
          roomReader(host.reader.state, { isOpen: () => false, commands: host.reader.commands, titles: pageTextSource() }).api),
      ...(overrides.createMixer ? { createMixer: overrides.createMixer } : {}),
      ...(overrides.createCompositor ? { createCompositor: overrides.createCompositor } : {}),
      ...(overrides.createRecorder ? { createRecorder: overrides.createRecorder } : {}),
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    perHost.set(host, c);
  }
  return c;
}
