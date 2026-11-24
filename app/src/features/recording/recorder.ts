// The session recorder in the owner's browser (spec 041 AC-007, AC-008; design docs/design/session-recording-and-broadcast.md
// 4.2–4.4). One clock: t0 is the moment the MediaRecorder starts, and the state writer's `now` is performance.now() - t0, so a
// state message's `t` and the media's currentTime * 1000 are the same timeline.
//
//   start → MediaRecorder(compositor video + mixed audio).start(5 s) → t0 → state writer starts (keyframe at t 0)
//   every 5 s: a media chunk → PUT media/:seq;  state messages so far → POST state (≤ 256 KB a batch)
//   stop → MediaRecorder stops (its last chunk) → final keyframe → last state batch → queue drained → finish { durationMs }
//   three failed uploads in a row → everything stops, status failed; what was stored stays (no finish)
import { createStreamWriter, type ReaderStateApi, type StreamMessage } from "@sefaria-social/session";
import type { RecordingApi } from "./recording-api";
import { createUploader } from "./uploader";

export const TIMESLICE_MS = 5_000;
export const STATE_BATCH_MS = 5_000;
export const STATE_BATCH_BYTES = 256 * 1024;
export const MIME_TYPES = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"] as const;
/** The first media type this browser can record (the same choice the recorder makes), or undefined when none is supported. */
export function pickMimeType(isTypeSupported: (mime: string) => boolean = (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)): string | undefined {
  return MIME_TYPES.find((m) => {
    try {
      return isTypeSupported(m);
    } catch {
      return false;
    }
  });
}
export const VIDEO_BITS_PER_SECOND = 600_000;
export const AUDIO_BITS_PER_SECOND = 64_000;

/** The parts of MediaRecorder the recorder uses (a fake in tests). */
export interface MediaRecorderLike {
  readonly state: "inactive" | "recording" | "paused";
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface MediaRecorderOptionsLike {
  mimeType?: string;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}

export type RecorderStatus = "recording" | "stopping" | "stopped" | "failed";

export interface SessionRecorderOptions {
  api: Pick<RecordingApi, "putMedia" | "putState" | "finish">;
  recordingId: string;
  /** The room's outgoing reader view (features/session/room-reader.ts): moment slices only, no ctx. */
  reader: ReaderStateApi;
  mixer: { stream: MediaStream };
  compositor: { stream: MediaStream; start(): void; stop(): void };
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptionsLike) => MediaRecorderLike;
  isTypeSupported?: (mime: string) => boolean;
  makeStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  /** The page's clock in ms (performance.now). */
  now?: () => number;
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Status changes: recording → stopping → stopped, or → failed. */
  onChange?: (status: RecorderStatus) => void;
}

export interface SessionRecorder {
  start(): void;
  /** Stop, upload what is left, finish. Resolves when done (or when the recording failed). */
  stop(): Promise<void>;
  status(): RecorderStatus;
  /** The recording's elapsed time in ms (the shared clock). */
  elapsed(): number;
  /** The mime type the MediaRecorder chose. */
  mimeType(): string;
}

/** The first mime type this browser records, or undefined to let it choose. */
export function chooseMimeType(isTypeSupported: (mime: string) => boolean): string | undefined {
  return MIME_TYPES.find((m) => {
    try {
      return isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

const encoder = new TextEncoder();
const size = (m: StreamMessage) => encoder.encode(JSON.stringify(m)).length + 1; // the comma between messages

/** Messages in order, split so each batch's body stays within `limit` bytes (a single larger message goes alone). */
export function batches(messages: readonly StreamMessage[], limit = STATE_BATCH_BYTES): StreamMessage[][] {
  const out: StreamMessage[][] = [];
  const envelope = encoder.encode('{"messages":[]}').length;
  let current: StreamMessage[] = [];
  let bytes = envelope;
  for (const m of messages) {
    const s = size(m);
    if (current.length && bytes + s > limit) {
      out.push(current);
      current = [];
      bytes = envelope;
    }
    current.push(m);
    bytes += s;
  }
  if (current.length) out.push(current);
  return out;
}

export function createSessionRecorder(opts: SessionRecorderOptions): SessionRecorder {
  const clock = opts.now ?? (() => performance.now());
  const set = opts.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const clear = opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const makeStream = opts.makeStream ?? ((tracks: MediaStreamTrack[]) => new MediaStream(tracks));
  const isTypeSupported =
    opts.isTypeSupported ?? ((m: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  const createMediaRecorder =
    opts.createMediaRecorder ??
    ((stream: MediaStream, o: MediaRecorderOptionsLike) => new MediaRecorder(stream, o) as unknown as MediaRecorderLike);

  let status: RecorderStatus = "recording";
  let t0 = 0;
  let stoppedAt: number | null = null;
  let seq = 0;
  let pending: StreamMessage[] = [];
  let batchTimer: unknown = null;
  let mediaRecorder: MediaRecorderLike | null = null;
  let mediaStopped: Promise<void> = Promise.resolve();
  let started = false;

  const elapsed = () => Math.max(0, (stoppedAt ?? clock()) - t0);
  const writer = createStreamWriter(opts.reader, { now: () => clock() - t0 });

  const current = (): RecorderStatus => status;
  const setStatus = (next: RecorderStatus) => {
    if (status === next) return;
    status = next;
    opts.onChange?.(next);
  };

  const uploader = createUploader({
    putMedia: (n, blob) => opts.api.putMedia(opts.recordingId, n, blob),
    putState: (messages) => opts.api.putState(opts.recordingId, messages),
    sleep: opts.sleep,
    onFatal: () => fail(),
  });

  const flushState = () => {
    if (!pending.length) return;
    const messages = pending;
    pending = [];
    for (const batch of batches(messages)) uploader.putState(batch).catch(() => undefined);
  };

  const halt = () => {
    if (batchTimer !== null) clear(batchTimer);
    batchTimer = null;
    writer.stop();
    opts.compositor.stop();
  };

  function fail() {
    if (status === "failed" || status === "stopped") return;
    halt();
    pending = [];
    setStatus("failed");
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch {
        // already stopping
      }
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      opts.compositor.start();
      const stream = makeStream([...opts.compositor.stream.getVideoTracks(), ...opts.mixer.stream.getAudioTracks()]);
      const mimeType = chooseMimeType(isTypeSupported);
      const mr = createMediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      mediaRecorder = mr;
      mediaStopped = new Promise<void>((resolve) => {
        mr.onstop = () => resolve();
      });
      mr.ondataavailable = (e) => {
        if (status === "failed" || !e.data || e.data.size === 0) return;
        uploader.putMedia(seq++, e.data).catch(() => undefined);
      };
      mr.onerror = () => fail();
      mr.start(TIMESLICE_MS);
      // The clock starts with the media: the writer's keyframe at start has t 0.
      t0 = clock();
      writer.start((m) => pending.push(m));
      batchTimer = set(flushState, STATE_BATCH_MS);
    },

    async stop() {
      if (status !== "recording" || !mediaRecorder) return;
      setStatus("stopping");
      stoppedAt = clock();
      const mr = mediaRecorder;
      if (mr.state !== "inactive") mr.stop();
      await mediaStopped; // the last chunk has arrived (dataavailable fires before stop)
      // A failure while waiting (status is changed by callbacks, so read it again).
      if (current() !== "stopping") return;
      writer.keyframe(); // the final keyframe
      halt();
      flushState();
      await uploader.idle();
      if (uploader.failed() || current() !== "stopping") return;
      try {
        await opts.api.finish(opts.recordingId, elapsed());
        setStatus("stopped");
      } catch {
        fail();
      }
    },

    status: () => status,
    elapsed,
    mimeType: () => mediaRecorder?.mimeType ?? "",
  };
}
