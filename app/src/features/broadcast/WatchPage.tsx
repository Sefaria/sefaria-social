import { useEffect, useState } from "react";
import { useViewer } from "~/features/host/use-viewer";
import { useHost } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { useBroadcastApi, type Broadcast } from "./broadcast-api";
import { useBroadcastController, useWatchView } from "./use-broadcast";
import styles from "./broadcast.module.css";

type PageState =
  | { kind: "loading" }
  | { kind: "ready"; broadcast: Broadcast }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "signed-out" };

/**
 * `/social/b/$broadcastId`: a broadcast's page (spec 043 AC-007, AC-008). Its title, its host and Watch, which takes the reader
 * to the host's text in the watch context and follows the host, with the host's audio and video in the floating window.
 * Signed out, Watch asks the reader to sign in first. An ended broadcast says so.
 */
export function WatchPage({ broadcastId }: { broadcastId: string }) {
  const t = useStrings();
  const host = useHost();
  const viewer = useViewer();
  const api = useBroadcastApi();
  const controller = useBroadcastController();
  const watch = useWatchView(controller);
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    if (!viewer) {
      setState({ kind: "signed-out" });
      return;
    }
    if (!api) {
      setState({ kind: "not-found" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    api.get(broadcastId).then(
      (r) => live && setState(r.kind === "ok" ? { kind: "ready", broadcast: r.broadcast } : { kind: "not-found" }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, viewer, broadcastId]);

  const endedHere = watch.kind === "ended" && watch.id === broadcastId;
  const ended = endedHere || (state.kind === "ready" && state.broadcast.status === "ended");

  if (state.kind === "signed-out")
    return (
      <main data-social-page="broadcast" data-broadcast-state="signed-out" className={styles.page}>
        <h1>{t.broadcastTitle}</h1>
        <p>{t.signInToWatch}</p>
        <div className={styles.actions}>
          <button type="button" data-action="watch" onClick={() => host?.viewer.requestSignIn()}>
            {t.watch}
          </button>
        </div>
      </main>
    );
  if (state.kind === "loading")
    return (
      <main data-social-page="broadcast" data-broadcast-state="loading">
        <p role="status">{t.loading}</p>
      </main>
    );
  if (state.kind === "not-found" || state.kind === "error")
    return (
      <main data-social-page="broadcast" data-broadcast-state={state.kind}>
        <h1>{t.broadcastTitle}</h1>
        <p role="alert">{state.kind === "not-found" ? t.broadcastNotFound : t.broadcastError}</p>
      </main>
    );

  const { broadcast } = state;
  const connecting = watch.kind === "connecting" && watch.id === broadcastId;
  return (
    <main data-social-page="broadcast" data-broadcast-state={ended ? "ended" : "live"} className={styles.page}>
      <h1>
        <bdi dir="auto">{broadcast.title || t.broadcastTitle}</bdi>
      </h1>
      {broadcast.hostName && (
        <p data-broadcast-host="">
          {t.broadcastBy} <bdi dir="auto">{broadcast.hostName}</bdi>
        </p>
      )}
      {ended ? (
        <p role="status" data-broadcast-ended="">
          {t.broadcastEnded}
        </p>
      ) : (
        <div className={styles.actions}>
          <button type="button" data-action="watch" disabled={connecting} onClick={() => void controller?.watch(broadcastId)}>
            {t.watch}
          </button>
          {connecting && <p role="status">{t.watchConnecting}</p>}
        </div>
      )}
      {watch.kind === "failed" && watch.id === broadcastId && (
        <p role="alert">{watch.reason === "not-found" ? t.broadcastNotFound : t.broadcastError}</p>
      )}
    </main>
  );
}
