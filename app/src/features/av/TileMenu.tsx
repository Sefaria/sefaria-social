import { useState } from "react";
import { useStrings } from "~/features/shell/use-strings";
import type { CallController } from "./call-controller";
import type { CallParticipant } from "./media";
import styles from "./av.module.css";

/**
 * The room owner's menu on another participant's tile (spec 039 AC-006): mute their microphone, turn off their camera, stop
 * their screen share (each only when it is on), and remove them from the call. Shown only to the owner; the server checks.
 */
export function TileMenu({ controller, participant }: { controller: CallController; participant: CallParticipant }) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  if (participant.local || controller.role() !== "owner") return null;
  const name = participant.name || t.someone;
  const act = (action: "mute" | "remove", source?: "microphone" | "camera" | "screen_share") => {
    setOpen(false);
    void controller.moderate(action, participant.id, source);
  };
  return (
    <span className={styles.tileMenu}>
      <button
        type="button"
        data-action="tile-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.moderate(name)}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <span role="menu" aria-label={t.moderate(name)} className={styles.menu}>
          {participant.mic && (
            <button type="button" role="menuitem" data-moderate="microphone" onClick={() => act("mute", "microphone")}>
              {t.muteMicrophone}
            </button>
          )}
          {participant.camera && (
            <button type="button" role="menuitem" data-moderate="camera" onClick={() => act("mute", "camera")}>
              {t.turnOffCamera}
            </button>
          )}
          {participant.screen && (
            <button type="button" role="menuitem" data-moderate="screen_share" onClick={() => act("mute", "screen_share")}>
              {t.stopScreenShare}
            </button>
          )}
          <button type="button" role="menuitem" data-moderate="remove" onClick={() => act("remove")}>
            {t.removeFromCall}
          </button>
        </span>
      )}
    </span>
  );
}
