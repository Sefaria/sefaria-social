import { useEffect, useState } from "react";
import { useHost } from "~/features/host/host-context";
import { absoluteLink } from "~/features/share/share";
import { useStrings } from "~/features/shell/use-strings";
import { useBroadcastController, useHostView } from "./use-broadcast";
import styles from "./broadcast.module.css";

/**
 * The lobby's broadcast panel for the room's owner (spec 043 AC-006): Broadcast starts one and publishes the owner's reader to
 * it; while live, the link to watch (absolute, on the reader's site) with Copy, how many are watching, Join the broadcast
 * call (the normal pre-join step) and End broadcast, which ends the session and the call.
 */
export function BroadcastPanel({ roomId, live }: { roomId: string; live?: { id: string; link: string } }) {
  const t = useStrings();
  const host = useHost();
  const controller = useBroadcastController();
  const view = useHostView(controller);
  const [copied, setCopied] = useState(false);
  // A reload loses the controller's state, not the broadcast: the room read names its live broadcast, and the host resumes it.
  useEffect(() => {
    if (controller && live && controller.hostView().kind === "idle") void controller.resume(roomId, live);
  }, [controller, roomId, live?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!controller) return null;
  const here = view.kind !== "idle" && view.roomId === roomId;

  if (here && view.kind === "live") {
    const link = absoluteLink(host, view.link);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <section aria-label={t.broadcastPanel} data-broadcast="live" className={styles.panel}>
        <p role="status">{t.broadcastLive}</p>
        <div className={styles.link}>
          <label>
            {t.broadcastLink}{" "}
            <input type="text" readOnly value={link} data-broadcast-link="" onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" data-action="copy-broadcast-link" onClick={() => void copy()}>
            {copied ? t.copied : t.copy}
          </button>
        </div>
        {view.viewers !== null && (
          <p data-broadcast-viewers="" className={styles.muted}>
            {t.watching(view.viewers)}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" data-action="join-broadcast-call" onClick={() => void controller.joinCall()}>
            {t.joinBroadcastCall}
          </button>
          <button type="button" data-action="end-broadcast" onClick={() => void controller.end()}>
            {t.endBroadcast}
          </button>
        </div>
      </section>
    );
  }

  const busy = view.kind === "starting" || view.kind === "ending" || view.kind === "live"; // live elsewhere: one at a time
  return (
    <section aria-label={t.broadcastPanel} data-broadcast={here ? view.kind : "idle"} className={styles.panel}>
      <div className={styles.actions}>
        <button type="button" data-action="broadcast" disabled={busy} onClick={() => void controller.start(roomId)}>
          {t.broadcast}
        </button>
      </div>
      {here && view.kind === "starting" && <p role="status">{t.broadcastStarting}</p>}
      {here && view.kind === "ending" && <p role="status">{t.endingBroadcast}</p>}
      {here && view.kind === "failed" && (
        <p role="alert">
          {view.reason === "already-live"
            ? t.broadcastAlreadyLive
            : view.reason === "forbidden"
              ? t.broadcastForbidden
              : t.broadcastFailed}
        </p>
      )}
    </section>
  );
}
