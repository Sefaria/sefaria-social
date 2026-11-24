import { useStrings } from "~/features/shell/use-strings";
import { CallFrame } from "./CallFrame";
import { Controls } from "./Controls";
import { Pill } from "./Pill";
import { PreJoin } from "./PreJoin";
import { Tiles } from "./Tiles";
import { useCallController, useCallView, useParticipants } from "./use-call";
import styles from "./av.module.css";

/**
 * The call, rendered by the persistent mount so it survives every route (spec 034; AV3). Nothing while there is no call.
 * Spec 035 puts the content in the floating window (./CallWindow.tsx); the pill is its smallest size. Spec 037 docks it as a
 * strip on a phone (./CallFrame.tsx chooses).
 */
export function CallPanel() {
  const t = useStrings();
  const controller = useCallController();
  const view = useCallView(controller);
  const participants = useParticipants(controller);
  if (!controller || view.kind === "off") return null;
  const media = controller.media();

  const mic = view.kind === "in-call" ? view.mic : null;
  return (
    <CallFrame pill={(expand) => <Pill controller={controller} participants={participants} mic={mic} onExpand={expand} />}>
      <section data-social-call={view.kind} aria-label={t.call} className={styles.panel}>
        {view.kind === "prejoin" && <PreJoin controller={controller} devices={view.devices} />}
        {view.kind === "connecting" && (
          <>
            <p role="status">{t.callConnecting}</p>
            <Controls controller={controller} mic={view.mic} camera={view.camera} screen={false} />
          </>
        )}
        {view.kind === "in-call" && (
          <>
            <Tiles controller={controller} participants={participants} />
            {media?.audioBlocked() && (
              <button type="button" data-action="start-audio" onClick={() => void media.startAudio()}>
                {t.startAudio}
              </button>
            )}
            <Controls controller={controller} mic={view.mic} camera={view.camera} screen={view.screen} />
            {view.switchTo && (
              <div role="alertdialog" aria-label={t.switchCall} data-switch-call={view.switchTo} className={styles.switch}>
                <p>{t.switchCall}</p>
                <button type="button" data-action="confirm-switch" onClick={() => void controller.confirmSwitch()}>
                  {t.switchYes}
                </button>
                <button type="button" data-action="cancel-switch" onClick={() => controller.cancelSwitch()}>
                  {t.switchNo}
                </button>
              </div>
            )}
          </>
        )}
        {view.kind === "reconnecting" && (
          <>
            <p role="status">{t.callReconnecting}</p>
            <button type="button" data-action="leave-call" onClick={() => void controller.leave()}>
              {t.leaveCall}
            </button>
          </>
        )}
        {view.kind === "ended" && (
          <>
            <p role="status">
              {view.reason === "removed" ? t.callRemoved : view.reason === "room-closed" ? t.callClosed : t.callLost}
            </p>
            {view.reason === "error" && (
              <button type="button" data-action="rejoin" onClick={() => void controller.open(view.roomId)}>
                {t.rejoin}
              </button>
            )}
            <button type="button" data-action="dismiss-call" onClick={() => controller.dismiss()}>
              {t.close}
            </button>
          </>
        )}
      </section>
    </CallFrame>
  );
}
