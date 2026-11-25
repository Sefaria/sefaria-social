import { useId, type KeyboardEvent } from "react";
import { useChromeInsets } from "~/features/av/insets";
import { useInterfaceLang } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { RATES, type ReplayPlayer, type ReplayPlayerView } from "./player";
import { chapterAt, type Chapter } from "./state-track";
import { formatLength } from "./use-replay";
import styles from "./replay.module.css";

/** How far the back and forward buttons and the arrow keys move (ms). */
export const SKIP_MS = 10_000;
export const ARROW_MS = 5_000;

/**
 * A shiur's player bar (spec 053): docked at the bottom of the page, above the reader's own bottom chrome. Play or pause, the
 * seek bar with a marker per chapter (its ref shown on hover and focus; a click goes there), back and forward 10 seconds, the
 * speed, hide or show the video, the time and the chapter playing, and Close. Space plays or pauses and the arrows move 5
 * seconds anywhere in the bar; the seek bar is a slider whose value text says the time and the chapter.
 */
export function ReplayBar({
  player,
  view,
  chapters,
  hasVideo,
  videoHidden,
  onToggleVideo,
  onClose,
}: {
  player: ReplayPlayer;
  view: ReplayPlayerView;
  chapters: readonly Chapter[];
  hasVideo: boolean;
  videoHidden: boolean;
  onToggleVideo: () => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const hebrew = useInterfaceLang() === "hebrew";
  const insets = useChromeInsets();
  const ticks = useId();
  const refOf = (c: Chapter) => (hebrew && c.heRef ? c.heRef : c.ref);
  const playing = chapterAt(chapters, view.t);
  const duration = Math.max(1, view.duration);
  const toggle = () => (view.playing ? player.pause() : void player.play().catch(() => undefined));
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const native = target.tagName === "INPUT" || (target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter"));
    if (e.key === " " && !native) {
      e.preventDefault();
      toggle();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target.tagName !== "INPUT") {
      e.preventDefault();
      const forward = (e.key === "ArrowRight") !== hebrew; // the arrows follow the reading direction
      player.skip(forward ? ARROW_MS : -ARROW_MS);
    }
  };
  return (
    <section
      role="region"
      aria-label={t.replayTitle}
      data-replay-bar=""
      className={styles.bar}
      style={{ insetBlockEnd: `${insets.bottom}px` }}
      onKeyDown={onKey}
    >
      <div className={styles.barSeek}>
        <input
          type="range"
          data-action="replay-scrub"
          aria-label={t.replayPosition}
          aria-valuetext={`${formatLength(view.t)} / ${formatLength(view.duration)}${playing ? ` · ${refOf(playing)}` : ""}`}
          min={0}
          max={Math.max(0, view.duration)}
          step={100}
          value={Math.min(view.t, view.duration)}
          list={ticks}
          onChange={(e) => player.seek(Number(e.currentTarget.value))}
        />
        <datalist id={ticks}>
          {view.keyframes.map((k) => (
            <option key={k} value={k} data-keyframe={k} />
          ))}
        </datalist>
        <ol className={styles.markers} aria-label={t.chapters}>
          {chapters.map((c) => (
            <li key={`${c.t}:${c.ref}`} style={{ insetInlineStart: `${(Math.min(c.t, duration) / duration) * 100}%` }}>
              <button
                type="button"
                className={styles.marker}
                data-chapter={c.t}
                data-current={playing === c || undefined}
                aria-label={t.goToChapter(refOf(c), formatLength(c.t))}
                title={refOf(c)}
                onClick={() => player.seek(c.t)}
              >
                <span className={styles.markerTip} aria-hidden="true">
                  <bdi dir="auto">{refOf(c)}</bdi>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.barControls}>
        <button type="button" data-action={view.playing ? "replay-pause" : "replay-play"} onClick={toggle}>
          {view.playing ? t.pause : t.play}
        </button>
        <button type="button" data-action="replay-back" aria-label={t.back10} onClick={() => player.skip(-SKIP_MS)}>
          −10
        </button>
        <button type="button" data-action="replay-forward" aria-label={t.forward10} onClick={() => player.skip(SKIP_MS)}>
          +10
        </button>
        <span className={styles.time} data-replay-time="">
          {formatLength(view.t)} / {formatLength(view.duration)}
        </span>
        {playing && (
          <span className={styles.chapterNow} data-replay-chapter="">
            <bdi dir="auto">{refOf(playing)}</bdi>
          </span>
        )}
        <span className={styles.barEnd}>
          {RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              data-rate={rate}
              aria-label={t.speed(String(rate))}
              aria-pressed={view.rate === rate}
              onClick={() => player.setRate(rate)}
            >
              {rate}×
            </button>
          ))}
          {hasVideo && (
            <button
              type="button"
              data-action={videoHidden ? "replay-show-video" : "replay-hide-video"}
              aria-pressed={!videoHidden}
              onClick={onToggleVideo}
            >
              {videoHidden ? t.showVideo : t.hideVideo}
            </button>
          )}
          <button type="button" data-action="replay-close" aria-label={t.closeReplay} onClick={onClose}>
            {t.close}
          </button>
        </span>
      </div>
    </section>
  );
}
