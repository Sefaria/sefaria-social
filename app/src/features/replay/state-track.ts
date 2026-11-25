// A recording's state track (spec 042; design docs/design/session-recording-and-broadcast.md section 5). The server hands back
// the `Recording` v1 document; it is parsed with the session schema, then checked the way a stream reader would: the first
// message is a keyframe, `seq` goes up by one per message and `t` never goes back. `snapshotAt(t)` is the reader state at a
// media time: the last keyframe at or before `t` (the first one when `t` is before it), with every later change up to `t`
// folded in. Its `key` names that point (keyframe index and changes applied), so the player applies a point once.
import { fold, parseRecording, type ReaderSnapshot } from "@sefaria-social/session";

/** The session's `Recording` v1 document, as parsed. */
export type Recording = NonNullable<ReturnType<typeof parseRecording>>;

/** A state track that fails the session schema or the stream's order. */
export class InvalidRecordingError extends Error {
  constructor(readonly reason: string) {
    super(`invalid recording: ${reason}`);
    this.name = "InvalidRecordingError";
  }
}

/** Parses and checks a state track; throws `InvalidRecordingError` for anything that is not a playable recording. */
export function parseStateTrack(json: unknown): Recording {
  const rec = parseRecording(json);
  if (!rec) throw new InvalidRecordingError("schema");
  const [first] = rec.messages;
  if (!first || first.type !== "keyframe") throw new InvalidRecordingError("the first message is not a keyframe");
  for (let i = 1; i < rec.messages.length; i++) {
    const prev = rec.messages[i - 1]!;
    const m = rec.messages[i]!;
    if (m.seq !== prev.seq + 1) throw new InvalidRecordingError(`seq ${m.seq} does not follow ${prev.seq}`);
    if (m.t < prev.t) throw new InvalidRecordingError(`t goes back at seq ${m.seq}`);
  }
  return rec;
}

/** The times (ms) of the track's keyframes, in order: the scrubber's ticks. */
export function keyframeTimes(rec: Recording): number[] {
  return rec.messages.flatMap((m) => (m.type === "keyframe" ? [m.t] : []));
}

/** Index of the last message with `t <= at`, or -1 when every message is later. Messages are ordered by `t`. */
function lastAtOrBefore(rec: Recording, at: number): number {
  let lo = 0;
  let hi = rec.messages.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rec.messages[mid]!.t <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Message positions of the keyframes, per recording (built once; a recording is never changed after parsing). */
const keyframePositions = new WeakMap<Recording, number[]>();
function positionsOf(rec: Recording): number[] {
  let p = keyframePositions.get(rec);
  if (!p) {
    p = rec.messages.flatMap((m, i) => (m.type === "keyframe" ? [i] : []));
    keyframePositions.set(rec, p);
  }
  return p;
}

/** The reader state at media time `t` (ms), and a key naming that point. */
export function snapshotAt(rec: Recording, t: number): { snapshot: ReaderSnapshot; key: string } {
  const last = Math.max(0, lastAtOrBefore(rec, t));
  const positions = positionsOf(rec);
  // The last keyframe at or before `last` (positions[0] is 0: parseStateTrack checked the first message is one).
  let lo = 0;
  let hi = positions.length - 1;
  let keyframeIndex = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid]! <= last) {
      keyframeIndex = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const k = positions[keyframeIndex] ?? 0;
  const keyframe = rec.messages[k];
  if (keyframe?.type !== "keyframe") throw new InvalidRecordingError("the first message is not a keyframe");
  let snapshot = keyframe.snapshot;
  let applied = 0;
  for (let i = k + 1; i <= last; i++) {
    const m = rec.messages[i]!;
    if (m.type === "change") {
      snapshot = fold(snapshot, m.change);
      applied++;
    }
  }
  return { snapshot, key: `${keyframeIndex}:${applied}` };
}
