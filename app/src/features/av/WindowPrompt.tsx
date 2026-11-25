import { useSyncExternalStore } from "react";
import { useHost } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { windowOwnerFor, type WindowOwner, type WindowOwnerControl } from "./window-owner";
import styles from "./av.module.css";

const noop = () => () => undefined;

/** The host's window owner, or null in standalone mode. */
export function useWindowOwner(): WindowOwnerControl | null {
  const host = useHost();
  return host ? windowOwnerFor(host) : null;
}

/** Who is asking for the window, re-rendering on every change. */
export function useWindowAsking(owner: WindowOwnerControl | null): WindowOwner | null {
  return useSyncExternalStore(
    owner ? (cb) => owner.subscribe(cb) : noop,
    () => owner?.asking() ?? null,
    () => null,
  );
}

/**
 * The question in the window that holds it (spec 042 AC-007) when the other asks for it: "Leave the call to play this
 * recording?" in the call's window, "Close the recording to join the call?" in the replay's. Nothing otherwise.
 */
export function WindowPrompt({ holder }: { holder: WindowOwner }) {
  const t = useStrings();
  const owner = useWindowOwner();
  const asking = useWindowAsking(owner);
  if (!owner || !asking || asking === holder) return null;
  const question = asking === "replay" ? t.leaveCallForReplay : t.closeReplayForCall;
  return (
    <div role="alertdialog" aria-label={question} data-window-prompt={asking} className={styles.switch}>
      <p>{question}</p>
      <button type="button" data-action="confirm-window" onClick={() => void owner.confirm()}>
        {t.confirm}
      </button>
      <button type="button" data-action="cancel-window" onClick={() => owner.cancel()}>
        {t.cancel}
      </button>
    </div>
  );
}
