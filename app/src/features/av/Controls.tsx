import { useStrings } from "~/features/shell/use-strings";
import { RecordButton } from "~/features/recording/RecordButton";
import type { CallController } from "./call-controller";
import { callRoom } from "./machine";
import styles from "./av.module.css";

/** Microphone, camera, screen share (where the browser has it) and Leave call (spec 034 AC-006, AC-007). */
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
  return (
    <div className={styles.controls}>
      <button type="button" data-action="mic" aria-pressed={mic} onClick={() => void controller.setMic(!mic)}>
        {t.microphone}
      </button>
      <button type="button" data-action="camera" aria-pressed={camera} onClick={() => void controller.setCamera(!camera)}>
        {t.camera}
      </button>
      {controller.canShareScreen() && (
        <button type="button" data-action="screen" aria-pressed={screen} onClick={() => void controller.setScreen(!screen)}>
          {t.shareScreen}
        </button>
      )}
      {roomId && controller.role() === "owner" && <RecordButton roomId={roomId} />}
      <button type="button" data-action="leave-call" className={styles.leave} onClick={() => void controller.leave()}>
        {t.leaveCall}
      </button>
    </div>
  );
}
