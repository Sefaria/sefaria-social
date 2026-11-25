import { useStrings } from "~/features/shell/use-strings";
import { useBroadcastController, useWatchView } from "./use-broadcast";
import styles from "./broadcast.module.css";

/**
 * The viewer's bar in the persistent mount while watching a broadcast (spec 043 AC-007, AC-008): whom they watch, Back to live
 * after breaking away, and Leave; when the broadcast ends, that it has, and Close. Mounting it also starts the controller's
 * watch of the address, so a cold load with `ctx=social.watch.<id>` rejoins as a viewer.
 */
export function WatchBar() {
  const t = useStrings();
  const controller = useBroadcastController();
  const view = useWatchView(controller);
  if (!controller || view.kind === "idle") return null;
  return (
    <div data-social-persistent="broadcast" data-watch-state={view.kind} className={styles.bar}>
      {view.kind === "connecting" && <p role="status">{t.watchConnecting}</p>}
      {view.kind === "watching" && (
        <>
          <p data-watch-line="">
            {t.watchingHost} <bdi dir="auto">{view.hostName || t.someone}</bdi>
          </p>
          {!view.following && (
            <button type="button" data-action="back-to-live" onClick={() => controller.backToLive()}>
              {t.backToLive}
            </button>
          )}
        </>
      )}
      {view.kind === "ended" && (
        <p role="status" data-broadcast-ended="">
          {t.broadcastEnded}
        </p>
      )}
      {view.kind === "failed" && <p role="alert">{view.reason === "not-found" ? t.broadcastNotFound : t.broadcastError}</p>}
      <button type="button" data-action="leave-broadcast" onClick={() => controller.leave()}>
        {view.kind === "watching" || view.kind === "connecting" ? t.leaveBroadcast : t.close}
      </button>
    </div>
  );
}
