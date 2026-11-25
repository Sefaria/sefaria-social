import { useEffect, useRef } from "react";
import { useStrings } from "~/features/shell/use-strings";
import type { CallController } from "./call-controller";
import type { CallParticipant, TrackSource } from "./media";
import { useCallWindowSize } from "./CallWindow";
import { MicIcon, initialsOf } from "./icons";
import { TileMenu } from "./TileMenu";
import { registerTileVideo } from "./tile-registry";
import type { SizeName } from "./window-geometry";
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
  // The track can arrive after the tile shows (a camera is on before its track is subscribed): try again on every change.
  useEffect(() => {
    const media = controller.media();
    const video = el.current;
    if (!media || !video) return;
    let detach: (() => void) | null = null;
    const tryAttach = () => {
      if (!detach) detach = media.attach(participantId, source, video);
    };
    tryAttach();
    const off = media.subscribe(tryAttach);
    return () => {
      off();
      detach?.();
    };
  }, [controller, participantId, source]);
  // The recorder's compositor draws camera tiles from the registry (spec 041).
  useEffect(() => {
    const video = el.current;
    if (source !== "camera" || !video) return;
    return registerTileVideo(participantId, video);
  }, [participantId, source]);
  return <video ref={el} className={styles.video} aria-label={label} autoPlay muted playsInline />;
}

/** How many tiles each window size holds (spec 035 AC-003); the rest show as "+N". */
export const TILE_LIMIT: Record<SizeName | "strip", number> = { pill: 0, small: 4, medium: 4, large: 9, custom: 4, strip: 1 };

/** The phone strip's one tile: whoever is speaking, else the first other person, else the viewer (spec 037). */
export function speakerFirst(participants: CallParticipant[]): CallParticipant[] {
  const rank = (p: CallParticipant) => (!p.local && p.speaking ? 0 : !p.local ? 1 : 2);
  return participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/** The viewer first, then whoever is speaking, then everyone else, in a stable order. */
export function tileOrder(participants: CallParticipant[]): CallParticipant[] {
  const rank = (p: CallParticipant) => (p.local ? 0 : p.speaking ? 1 : 2);
  return participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * The call's tiles (spec 034 AC-006): one per participant, with their camera when it is on, their name, a muted mark and a
 * speaking ring; screen shares get their own tile. Audio plays through the engine's hidden elements, not here. The window's
 * size decides how many tiles show (spec 035); only participants with a tile receive video (AC-011), and audio is untouched.
 */
export function Tiles({ controller, participants }: { controller: CallController; participants: CallParticipant[] }) {
  const t = useStrings();
  const size = useCallWindowSize();
  const ordered = size === "strip" ? speakerFirst(participants) : tileOrder(participants);
  const shown = ordered.slice(0, TILE_LIMIT[size]);
  const more = ordered.length - shown.length;
  const visibleKey = shown
    .filter((p) => !p.local)
    .map((p) => p.id)
    .join(",");
  useEffect(() => {
    const media = controller.media();
    media?.setVisible(visibleKey ? visibleKey.split(",") : []);
    return () => media?.setVisible([]);
  }, [controller, visibleKey]);
  const screens = shown.filter((p) => p.screen);
  return (
    <ul className={styles.tiles}>
      {screens.map((p) => (
        <li key={`${p.id}:screen`} data-participant-screen={p.id} className={styles.tile}>
          <Video controller={controller} participantId={p.id} source="screen" label={t.screenOf(p.name || t.someone)} />
        </li>
      ))}
      {shown.map((p) => (
        <li
          key={p.id}
          data-participant={p.id}
          data-speaking={p.speaking}
          data-camera={p.camera || undefined}
          className={`${styles.tile} ${p.speaking ? styles.speaking : ""}`}
        >
          {p.camera ? (
            <Video controller={controller} participantId={p.id} source="camera" label={p.name || t.someone} />
          ) : (
            <span className={styles.initials} aria-hidden="true" data-initials="">
              {initialsOf(p.name || t.someone)}
            </span>
          )}
          <span className={styles.name}>
            {!p.mic && (
              <span className={styles.mutedIcon}>
                <MicIcon off />
              </span>
            )}
            <bdi dir="auto">{p.name || t.someone}</bdi>
            {p.local && <> ({t.you})</>}
            {!p.mic && <span className={styles.muted}> · {t.muted}</span>}
          </span>
          <TileMenu controller={controller} participant={p} />
        </li>
      ))}
      {more > 0 && (
        <li data-more-participants="" className={`${styles.tile} ${styles.moreTile}`}>
          {t.moreParticipants(more)}
        </li>
      )}
    </ul>
  );
}
