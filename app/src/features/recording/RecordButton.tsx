import { useEffect, useState } from "react";
import { useStrings } from "~/features/shell/use-strings";
import { useRecordingController, useRecordingView } from "./use-recording";
import styles from "./recording.module.css";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
};

/**
 * Record and Stop recording, with the elapsed time (spec 041 AC-007). Shown to the room's owner only (the caller decides; the
 * server refuses anyone else). A failed recording tells the owner here (AC-008).
 */
export function RecordButton({ roomId }: { roomId: string }) {
  const t = useStrings();
  const controller = useRecordingController();
  const view = useRecordingView(controller);
  const [now, setNow] = useState(() => Date.now());
  const running = view.kind === "recording";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!controller) return null;
  // Recording another room: one recording at a time, so nothing to offer here.
  if (view.kind !== "idle" && view.kind !== "failed" && view.roomId !== roomId) return null;
  const failed = view.kind === "failed" && view.roomId === roomId ? view.reason : null;
  return (
    <div className={styles.record} data-recording-state={view.kind}>
      {view.kind === "recording" ? (
        <>
          <button type="button" data-action="stop-recording" onClick={() => void controller.stop()}>
            {t.stopRecording}
          </button>
          <span data-recording-elapsed="">{t.recordingElapsed(clock(now - view.since))}</span>
        </>
      ) : view.kind === "starting" || view.kind === "stopping" ? (
        <button type="button" data-action="record" disabled>
          {view.kind === "starting" ? t.startingRecording : t.stoppingRecording}
        </button>
      ) : (
        <button type="button" data-action="record" onClick={() => void controller.start(roomId)}>
          {t.record}
        </button>
      )}
      {failed && (
        <p role="alert" data-recording-error={failed} className={styles.error}>
          {failed === "upload" ? t.recordingUploadFailed : t.recordingUnavailable}
        </p>
      )}
    </div>
  );
}

/**
 * The one Record control of the room window (spec 050 AC-001), for the room's owner while they lead: Record starts recording the
 * room, then the same control pauses and resumes it, any number of times; the time shown leaves the paused stretches out. The
 * recording is finished by the session's ending (Finish and save, Close room) or Stop recording in the lobby.
 */
export function RecordToggle({ roomId }: { roomId: string }) {
  const t = useStrings();
  const controller = useRecordingController();
  const view = useRecordingView(controller);
  const [, tick] = useState(0);
  const running = view.kind === "recording" && !view.paused;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!controller) return null;
  if (view.kind !== "idle" && view.kind !== "failed" && view.roomId !== roomId) return null;
  const busy = view.kind === "starting" || view.kind === "stopping";
  const state = view.kind === "recording" ? (view.paused ? "paused" : "recording") : view.kind;
  const press = () => {
    if (view.kind === "recording") return view.paused ? controller.resume() : controller.pause();
    if (view.kind === "idle" || view.kind === "failed") void controller.start(roomId);
  };
  const label =
    view.kind === "recording"
      ? view.paused
        ? t.resumeRecording
        : t.pauseRecording
      : view.kind === "starting"
        ? t.startingRecording
        : view.kind === "stopping"
          ? t.stoppingRecording
          : t.record;
  return (
    <div className={styles.record} data-record-toggle={state}>
      <button
        type="button"
        data-action="record-toggle"
        aria-pressed={view.kind === "recording" && !view.paused}
        disabled={busy}
        onClick={press}
      >
        {label}
      </button>
      {view.kind === "recording" && <span data-recording-elapsed="">{t.recordingElapsed(clock(controller.elapsed()))}</span>}
      {view.kind === "failed" && view.roomId === roomId && (
        <p role="alert" data-recording-error={view.reason} className={styles.error}>
          {view.reason === "upload" ? t.recordingUploadFailed : t.recordingUnavailable}
        </p>
      )}
    </div>
  );
}
