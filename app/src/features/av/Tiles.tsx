import { useEffect, useRef } from "react";
import { useStrings } from "~/features/shell/use-strings";
import type { CallController } from "./call-controller";
import type { CallParticipant, TrackSource } from "./media";
import styles from "./av.module.css";

function Video({
  controller,
  participantId,
  source,
  label,
}: {
  controller: CallController;
  participantId: string;
  source: TrackSource;
  label: string;
}) {
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = controller.media();
    if (!media || !el.current) return;
    return media.attach(participantId, source, el.current);
  }, [controller, participantId, source]);
  return <video ref={el} className={styles.video} aria-label={label} autoPlay muted playsInline />;
}

/**
 * The call's tiles (spec 034 AC-006): one per participant, with their camera when it is on, their name, a muted mark and a
 * speaking ring; screen shares get their own tile. Audio plays through the engine's hidden elements, not here. Spec 035 decides
 * how many tiles fit the window; until then every tile is visible.
 */
export function Tiles({ controller, participants }: { controller: CallController; participants: CallParticipant[] }) {
  const t = useStrings();
  useEffect(() => {
    controller.media()?.setVisible(participants.filter((p) => !p.local).map((p) => p.id));
  }, [controller, participants]);
  const screens = participants.filter((p) => p.screen);
  return (
    <ul className={styles.tiles}>
      {screens.map((p) => (
        <li key={`${p.id}:screen`} data-participant-screen={p.id} className={styles.tile}>
          <Video controller={controller} participantId={p.id} source="screen" label={t.screenOf(p.name || t.someone)} />
        </li>
      ))}
      {participants.map((p) => (
        <li
          key={p.id}
          data-participant={p.id}
          data-speaking={p.speaking}
          className={`${styles.tile} ${p.speaking ? styles.speaking : ""}`}
        >
          {p.camera && <Video controller={controller} participantId={p.id} source="camera" label={p.name || t.someone} />}
          <span className={styles.name}>
            <bdi dir="auto">{p.name || t.someone}</bdi>
            {p.local && <> ({t.you})</>}
            {!p.mic && <span className={styles.muted}> · {t.muted}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
