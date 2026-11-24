import { useStrings } from "~/features/shell/use-strings";
import styles from "./recording.module.css";

/** The red Recording badge (spec 041 AC-006): everyone in a recorded room is told, in the call window, the strip and the pill. */
export function RecordingBadge({ on }: { on: boolean }) {
  const t = useStrings();
  if (!on) return null;
  return (
    <span role="status" data-recording-badge="" className={styles.badge}>
      <span aria-hidden="true" className={styles.dot} />
      {t.recording}
    </span>
  );
}
