import { useStrings } from "~/features/shell/use-strings";
import { RecordButton } from "~/features/recording/RecordButton";
import type { CallController } from "./call-controller";
import { callRoom } from "./machine";
import { CameraIcon, LeaveIcon, MicIcon, ScreenIcon } from "./icons";
import styles from "./av.module.css";

/**
 * Microphone, camera, screen share (where the browser has it) and Leave call (spec 034 AC-006, AC-007). A broadcast's viewer
 * (spec 043) publishes nothing: Leave only. Record is a room's owner's, in a room's call.
 */
export function Controls({
  controller,
  mic,
  camera,
  screen,
}: {
  controller: CallController;
  mic: boolean;
  camera: boolean;
  screen: boolean;
}) {
  const t = useStrings();
  const roomId = callRoom(controller.view());
  const mode = controller.mode();
  const leave = (
    <button
      type="button"
      data-action="leave-call"
      className={styles.leave}
      title={t.leaveCall}
      onClick={() => void controller.leave()}
    >
      <LeaveIcon />
      <span className={styles.label}>{t.leaveCall}</span>
    </button>
  );
  if (mode === "viewer") return <div className={styles.controls}>{leave}</div>;
  return (
    <div className={styles.controls}>
      <button
        type="button"
        data-action="mic"
        aria-pressed={mic}
        className={styles.round}
        title={t.microphone}
        onClick={() => void controller.setMic(!mic)}
      >
        <MicIcon off={!mic} />
        <span className={styles.label}>{t.microphone}</span>
      </button>
      <button
        type="button"
        data-action="camera"
        aria-pressed={camera}
        className={styles.round}
        title={t.camera}
        onClick={() => void controller.setCamera(!camera)}
      >
        <CameraIcon off={!camera} />
        <span className={styles.label}>{t.camera}</span>
      </button>
      {controller.canShareScreen() && (
        <button
          type="button"
          data-action="screen"
          aria-pressed={screen}
          className={styles.round}
          title={t.shareScreen}
          onClick={() => void controller.setScreen(!screen)}
        >
          <ScreenIcon />
          <span className={styles.label}>{t.shareScreen}</span>
        </button>
      )}
      {roomId && mode === "room" && controller.role() === "owner" && <RecordButton roomId={roomId} />}
      {leave}
    </div>
  );
}
