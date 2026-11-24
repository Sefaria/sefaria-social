import { useStrings } from "~/features/shell/use-strings";
import { RecordingBadge } from "~/features/recording/RecordingBadge";
import { useCallRecording } from "~/features/recording/use-recording";
import type { CallController } from "./call-controller";
import type { CallParticipant } from "./media";
import { tileOrder } from "./Tiles";
import styles from "./window.module.css";

const AVATARS = 4;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/**
 * The call window's smallest size (spec 035 AC-003): who is on the call, who is speaking, the microphone, and Expand. No video
 * is received while it shows (AC-011).
 */
export function Pill({
  controller,
  participants,
  mic,
  onExpand,
}: {
  controller: CallController;
  participants: CallParticipant[];
  mic: boolean | null;
  onExpand: () => void;
}) {
  const t = useStrings();
  const ordered = tileOrder(participants);
  const shown = ordered.slice(0, AVATARS);
  const recording = useCallRecording(controller);
  return (
    <div data-call-pill="" className={styles.pill} data-social-call={controller.view().kind}>
      <RecordingBadge on={recording} />
      {shown.map((p) => (
        <span
          key={p.id}
          data-pill-participant={p.id}
          data-speaking={p.speaking}
          className={styles.avatar}
          title={p.name || t.someone}
          aria-label={`${p.name || t.someone}${p.speaking ? `, ${t.speaking}` : ""}`}
          role="img"
        >
          {initials(p.name || t.someone)}
        </span>
      ))}
      {ordered.length > shown.length && <span className={styles.more}>{t.moreParticipants(ordered.length - shown.length)}</span>}
      {mic !== null && (
        <button type="button" data-action="mic" aria-pressed={mic} onClick={() => void controller.setMic(!mic)}>
          {t.microphone}
        </button>
      )}
      <button type="button" data-action="expand-call" onClick={onExpand}>
        {t.expand}
      </button>
    </div>
  );
}
