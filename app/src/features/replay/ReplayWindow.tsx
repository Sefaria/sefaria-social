import { useEffect, useRef } from "react";
import { CallFrame } from "~/features/av/CallFrame";
import { WindowPrompt } from "~/features/av/WindowPrompt";
import { useStrings } from "~/features/shell/use-strings";
import type { ReplayController } from "./replay-controller";
import { Transport } from "./Transport";
import { formatLength, useReplayController, useReplayView } from "./use-replay";
import styles from "./replay.module.css";

/** The controller's media element, placed in the window while the replay is ready (it is created and owned by the controller). */
function MediaBox({ controller, recordingId }: { controller: ReplayController; recordingId: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = controller.mediaElement();
    const host = box.current;
    if (!host || !(el instanceof Node)) return;
    host.append(el);
    return () => {
      if (el.parentNode === host) host.removeChild(el);
    };
  }, [controller, recordingId]);
  return <div ref={box} className={styles.media} data-replay-media="" />;
}

/**
 * A recording's replay in the floating window (spec 042 AC-002, AC-004, AC-005, AC-008): the call's frame (the same place, size,
 * drag, resize, snap and keys; the strip on a phone) around the video, a loading bar while the media arrives, the transport, and
 * "You left the recording · Back to the recording" once the person reads around. Nothing while no replay is open.
 */
export function ReplayWindow() {
  const t = useStrings();
  const controller = useReplayController();
  const view = useReplayView(controller);
  if (!controller || view.kind === "closed") return null;
  const player = controller.player();
  const close = () => controller.close();
  const closeButton = (
    <button type="button" data-action="replay-close" aria-label={t.closeReplay} onClick={close}>
      {t.close}
    </button>
  );

  return (
    <CallFrame
      owner="replay"
      label={t.replayWindow}
      title={t.replayTitle}
      prompt={<WindowPrompt holder="replay" />}
      pill={(expand) => (
        <div className={styles.pill} data-replay-pill="">
          {view.kind === "ready" && player && (
            <button
              type="button"
              data-action={view.player.playing ? "replay-pause" : "replay-play"}
              onClick={() => (view.player.playing ? player.pause() : void player.play().catch(() => undefined))}
            >
              {view.player.playing ? t.pause : t.play}
            </button>
          )}
          {view.kind === "ready" && <span className={styles.time}>{formatLength(view.player.t)}</span>}
          <button type="button" data-action="expand-replay" onClick={expand}>
            {t.expand}
          </button>
        </div>
      )}
    >
      <section data-social-replay={view.kind} aria-label={t.replayTitle} className={styles.replay}>
        {view.kind === "loading" && (
          <>
            <progress
              className={styles.progress}
              aria-label={t.replayLoading}
              max={1}
              {...(view.progress === null ? {} : { value: view.progress })}
            />
            {closeButton}
          </>
        )}
        {view.kind === "error" && (
          <>
            <p role="alert" className={styles.error} data-replay-error={view.reason}>
              {t.recordingCouldNotPlay}
            </p>
            {closeButton}
          </>
        )}
        {view.kind === "ready" && player && (
          <>
            <MediaBox controller={controller} recordingId={view.recordingId} />
            {!view.player.following && (
              <div role="status" className={styles.left} data-replay-left="">
                <span>{t.leftRecording}</span>
                <button type="button" data-action="replay-rejoin" onClick={() => player.rejoin()}>
                  {t.backToRecording}
                </button>
              </div>
            )}
            <Transport player={player} view={view.player} onClose={close} />
          </>
        )}
      </section>
    </CallFrame>
  );
}
