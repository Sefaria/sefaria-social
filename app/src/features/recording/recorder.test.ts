// The recorder in the owner's browser (spec 041) against a fake MediaRecorder, fake streams, a fake reader and a fake recording
// API with the real API's methods. The modules load through import.meta.glob so that, on a base without them, the first
// assertion fails instead of the import.
import { describe, expect, it, vi } from "vitest";
import type { ReaderSnapshot, ReaderStateApi, SnapshotChange, StreamMessage } from "@sefaria-social/session";
import type * as RecorderModule from "./recorder";
import type * as ControllerModule from "./recording-controller";

const mods = {
  recorder: import.meta.glob<typeof RecorderModule>("./recorder.ts"),
  controller: import.meta.glob<typeof ControllerModule>("./recording-controller.ts"),
};

async function loadRecorder() {
  const mod = await mods.recorder["./recorder.ts"]?.();
  expect(mod, "app/src/features/recording/recorder.ts exists").toBeDefined();
  return mod!;
}

const track = (kind: "audio" | "video", id: string) => ({ kind, id, readyState: "live" }) as unknown as MediaStreamTrack;
const fakeStream = (tracks: MediaStreamTrack[]) =>
  ({
    tracks,
    getTracks: () => [...tracks],
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  }) as unknown as MediaStream & { tracks: MediaStreamTrack[] };

/** A MediaRecorder the test drives: `chunk()` is a timeslice ending; `stop()` delivers the last chunk, then `stop`. */
function fakeMediaRecorders() {
  const made: {
    stream: MediaStream & { tracks?: MediaStreamTrack[] };
    options: RecorderModule.MediaRecorderOptionsLike;
    rec: RecorderModule.MediaRecorderLike & {
      timeslice: number | null;
      stops: number;
      pauses: number;
      chunk(label: string): void;
    };
  }[] = [];
  const create = (stream: MediaStream, options: RecorderModule.MediaRecorderOptionsLike) => {
    const rec = {
      state: "inactive" as "inactive" | "recording" | "paused",
      mimeType: options.mimeType ?? "",
      ondataavailable: null as ((e: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      timeslice: null as number | null,
      stops: 0,
      start(timeslice?: number) {
        rec.state = "recording";
        rec.timeslice = timeslice ?? null;
      },
      chunk(label: string) {
        rec.ondataavailable?.({ data: new Blob([label]) });
      },
      pauses: 0,
      pause() {
        rec.pauses++;
        rec.state = "paused";
      },
      resume() {
        rec.state = "recording";
      },
      stop() {
        rec.stops++;
        if (rec.state === "inactive") return;
        rec.state = "inactive";
        rec.chunk("last chunk");
        setTimeout(() => rec.onstop?.(), 0);
      },
    };
    made.push({ stream, options, rec });
    return rec;
  };
  return { made, create };
}

/** A reader whose person moves: `move(url)` reports a change, like the room's outgoing view. */
function fakeReader() {
  let url = "/Genesis.1";
  const listeners = new Set<(c: SnapshotChange, s: ReaderSnapshot) => void>();
  const snapshot = (): ReaderSnapshot => ({ v: 1, url, nav: null, slices: {} });
  const api: ReaderStateApi = {
    getSnapshot: snapshot,
    applySnapshot: async () => ({ warnings: [] }),
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    onLocalInput: () => () => undefined,
    applying: false,
  };
  return {
    api,
    move(next: string) {
      url = next;
      for (const cb of listeners) cb({ url: next }, snapshot());
    },
  };
}

function fakeApi(opts: { failMedia?: boolean } = {}) {
  const log: string[] = [];
  const media: { id: string; seq: number; text: Promise<string> }[] = [];
  const state: StreamMessage[] = [];
  const finished: { id: string; durationMs: number }[] = [];
  let mediaAttempts = 0;
  return {
    log,
    media,
    state,
    finished,
    mediaAttempts: () => mediaAttempts,
    start: vi.fn(async () => ({ kind: "ok" as const, id: "rec-1" })),
    async putMedia(id: string, seq: number, blob: Blob) {
      mediaAttempts++;
      if (opts.failMedia) throw new Error("network down");
      log.push(`media ${seq}`);
      media.push({ id, seq, text: blob.text() });
    },
    async putState(_id: string, messages: StreamMessage[]) {
      log.push(`state ${messages.length}`);
      state.push(...messages);
    },
    async finish(id: string, durationMs: number) {
      log.push("finish");
      finished.push({ id, durationMs });
    },
  };
}

/** Manual timers and clock: `tick()` runs the recorder's intervals once. */
function fakeTime(start = 1_000) {
  let t = start;
  const intervals = new Map<number, { cb: () => void; ms: number }>();
  let next = 1;
  return {
    now: () => t,
    advance: (ms: number) => void (t += ms),
    setInterval: (cb: () => void, ms: number) => {
      const id = next++;
      intervals.set(id, { cb, ms });
      return id;
    },
    clearInterval: (id: unknown) => void intervals.delete(id as number),
    tick: () => [...intervals.values()].forEach((i) => i.cb()),
    intervals,
  };
}

function setup(mod: typeof RecorderModule, opts: { failMedia?: boolean; supported?: string[] } = {}) {
  const api = fakeApi(opts);
  const reader = fakeReader();
  const time = fakeTime();
  const recorders = fakeMediaRecorders();
  const video = track("video", "canvas-video");
  const audio = track("audio", "mixed-audio");
  const compositor = { stream: fakeStream([video]), start: vi.fn(), stop: vi.fn() };
  const mixer = { stream: fakeStream([audio]) };
  const statuses: string[] = [];
  const supported = opts.supported ?? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  const recorder = mod.createSessionRecorder({
    api,
    recordingId: "rec-1",
    reader: reader.api,
    mixer,
    compositor,
    createMediaRecorder: recorders.create,
    isTypeSupported: (m) => supported.includes(m),
    makeStream: fakeStream,
    now: time.now,
    setInterval: time.setInterval,
    clearInterval: time.clearInterval,
    sleep: async () => undefined,
    onChange: (s) => statuses.push(s),
  });
  return { api, reader, time, recorders, recorder, compositor, video, audio, statuses };
}

describe("Record on and off (spec 050)", () => {
  // @feature SESS-074 Record on and off during a session, on one clock
  // @ac 050/AC-001
  it("pauses the media and the clock, sends nothing while paused, and cuts the paused time from both tracks", async () => {
    const mod = await loadRecorder();
    const { api, reader, time, recorders, recorder } = setup(mod);
    expect(typeof recorder.pause, "the recorder can pause").toBe("function");
    recorder.start();
    const [{ rec }] = recorders.made as [(typeof recorders.made)[number]];

    time.advance(1_000);
    reader.move("/Genesis.2");
    time.advance(2_000);
    recorder.pause!();
    expect(rec.pauses).toBe(1);
    expect(recorder.paused!()).toBe(true);
    time.advance(5_000);
    reader.move("/Genesis.9"); // while paused: not recorded
    time.advance(5_000);
    recorder.resume!();
    expect(recorder.paused!()).toBe(false);
    time.advance(2_000);
    reader.move("/Genesis.3");
    time.advance(1_000);
    await recorder.stop();

    expect(api.finished).toEqual([{ id: "rec-1", durationMs: 6_000 }]);
    expect(api.state.map((m) => [m.type, m.t, m.type === "keyframe" ? m.snapshot.url : m.change.url])).toEqual([
      ["keyframe", 0, "/Genesis.1"],
      ["change", 1_000, "/Genesis.2"],
      ["keyframe", 3_000, "/Genesis.9"], // resuming says where the reader is now, at the clock's own 3 s
      ["change", 5_000, "/Genesis.3"],
      ["keyframe", 6_000, "/Genesis.3"],
    ]);
  });
});

describe("recording a session in the owner's browser (spec 041)", () => {
  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-007
  it("records the composited video and mixed audio in 5 s chunks on the state's clock, and Stop uploads the last chunk, a final keyframe, then finishes", async () => {
    const mod = await loadRecorder();
    const { api, reader, time, recorders, recorder, compositor, video, audio } = setup(mod, {
      supported: ["video/webm", "video/mp4"],
    });

    recorder.start();
    const [{ stream, options, rec }] = recorders.made as [(typeof recorders.made)[number]];
    expect(stream.tracks).toEqual([video, audio]);
    expect(options).toEqual({ mimeType: "video/webm", videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 });
    expect(rec.timeslice).toBe(5_000);
    expect(compositor.start).toHaveBeenCalledTimes(1);

    time.advance(2_000);
    reader.move("/Genesis.2");
    time.advance(3_000);
    rec.chunk("chunk 0");
    time.tick(); // the 5 s state batch
    time.advance(5_000);
    rec.chunk("chunk 1");
    time.advance(1_500);
    await recorder.stop();

    expect(api.media.map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(await Promise.all(api.media.map((m) => m.text))).toEqual(["chunk 0", "chunk 1", "last chunk"]);
    expect(api.state.map((m) => [m.type, m.seq, m.t])).toEqual([
      ["keyframe", 0, 0],
      ["change", 1, 2_000],
      ["keyframe", 2, 11_500],
    ]);
    expect(api.finished).toEqual([{ id: "rec-1", durationMs: 11_500 }]);
    expect(api.log).toEqual(["media 0", "state 2", "media 1", "media 2", "state 1", "finish"]);
    expect(recorder.status()).toBe("stopped");
    expect(compositor.stop).toHaveBeenCalled();
    expect(time.intervals.size).toBe(0);
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-008
  it("stops recording after an upload fails three times in a row, keeps what was stored and does not finish", async () => {
    const mod = await loadRecorder();
    const { api, time, recorders, recorder, compositor, statuses } = setup(mod, { failMedia: true });

    recorder.start();
    const [{ rec }] = recorders.made as [(typeof recorders.made)[number]];
    time.tick(); // the opening keyframe is stored
    time.advance(5_000);
    rec.chunk("chunk 0");
    await vi.waitFor(() => expect(recorder.status()).toBe("failed"));

    expect(api.mediaAttempts()).toBe(3);
    expect(statuses).toEqual(["failed"]);
    expect(rec.state).toBe("inactive");
    expect(compositor.stop).toHaveBeenCalled();
    expect(time.intervals.size).toBe(0);
    rec.chunk("chunk 1");
    await recorder.stop();
    expect(api.mediaAttempts()).toBe(3);
    expect(api.state.map((m) => m.type)).toEqual(["keyframe"]);
    expect(api.finished).toEqual([]);
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-008
  it("tells the owner when the upload failed, and mixes the call's audio as it changes until then", async () => {
    const mod = await loadRecorder();
    const controllerMod = (await mods.controller["./recording-controller.ts"]!())!;
    const api = fakeApi({ failMedia: true });
    const reports: string[] = [];
    const host = { report: (e: { name: string }) => reports.push(e.name), ui: { interfaceLang: "english" } };
    const callListeners = new Set<() => void>();
    const mediaListeners = new Set<() => void>();
    let audioTracks = [track("audio", "mic")];
    const media = {
      audioTracks: () => audioTracks,
      participants: () => [],
      subscribe(cb: () => void) {
        mediaListeners.add(cb);
        return () => void mediaListeners.delete(cb);
      },
    };
    const call = {
      media: () => media as never,
      subscribe(cb: () => void) {
        callListeners.add(cb);
        return () => void callListeners.delete(cb);
      },
    };
    const mixed: string[][] = [];
    const recorders = fakeMediaRecorders();
    const time = fakeTime();
    const controller = controllerMod.createRecordingController({
      host: host as never,
      api,
      call,
      roomTitle: async () => "Daf Yomi",
      reader: () => fakeReader().api,
      createMixer: () => ({
        stream: fakeStream([track("audio", "mixed")]),
        setTracks: (ts) => void mixed.push(ts.map((t) => t.id)),
        dispose: vi.fn(),
      }),
      createCompositor: () => ({ stream: fakeStream([track("video", "canvas")]), start: vi.fn(), stop: vi.fn(), draw: vi.fn() }),
      createRecorder: (o) =>
        mod.createSessionRecorder({
          ...o,
          createMediaRecorder: recorders.create,
          isTypeSupported: () => true,
          makeStream: fakeStream,
          now: time.now,
          setInterval: time.setInterval,
          clearInterval: time.clearInterval,
          sleep: async () => undefined,
        }),
      now: () => 50_000,
    });

    await controller.start("room-1");
    expect(api.start).toHaveBeenCalledWith("room-1", undefined);
    expect(controller.view()).toEqual({ kind: "recording", roomId: "room-1", since: 50_000 });
    audioTracks = [track("audio", "mic"), track("audio", "guest")];
    mediaListeners.forEach((cb) => cb());
    expect(mixed).toEqual([["mic"], ["mic", "guest"]]);

    recorders.made[0]!.rec.chunk("chunk 0");
    await vi.waitFor(() => expect(controller.view()).toEqual({ kind: "failed", roomId: "room-1", reason: "upload" }));
    expect(reports).toEqual(["recording.start", "recording.error"]);
    expect(mediaListeners.size).toBe(0);
    expect(callListeners.size).toBe(0);
  });
});
