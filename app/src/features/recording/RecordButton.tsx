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
