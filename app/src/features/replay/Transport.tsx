import { useId } from "react";
import { useStrings } from "~/features/shell/use-strings";
import { RATES, type ReplayPlayer, type ReplayPlayerView } from "./player";
import { formatLength } from "./use-replay";
import styles from "./replay.module.css";

/** How far the back and forward buttons move (ms). */
export const SKIP_MS = 10_000;

/**
 * The replay's transport (spec 042 AC-004): play or pause, the scrubber (its ticks are the recording's keyframes), back and
 * forward 10 seconds, the speed (1×, 1.5×, 2×), Close, and the time. Every control acts on the player, which moves the media and
 * the reader together.
 */
export function Transport({ player, view, onClose }: { player: ReplayPlayer; view: ReplayPlayerView; onClose: () => void }) {
  const t = useStrings();
  const ticks = useId();
  return (
    <div className={styles.transport} data-replay-transport="">
      <div className={styles.scrubber}>
        <input
          type="range"
          data-action="replay-scrub"
          aria-label={t.replayPosition}
          aria-valuetext={`${formatLength(view.t)} / ${formatLength(view.duration)}`}
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
      </div>
      <button
        type="button"
        data-action={view.playing ? "replay-pause" : "replay-play"}
        onClick={() => (view.playing ? player.pause() : void player.play().catch(() => undefined))}
      >
        {view.playing ? t.pause : t.play}
      </button>
      <button type="button" data-action="replay-back" aria-label={t.back10} onClick={() => player.skip(-SKIP_MS)}>
        −10
      </button>
      <button type="button" data-action="replay-forward" aria-label={t.forward10} onClick={() => player.skip(SKIP_MS)}>
        +10
      </button>
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
      <span className={styles.time} data-replay-time="">
        {formatLength(view.t)} / {formatLength(view.duration)}
      </span>
      <button type="button" data-action="replay-close" aria-label={t.closeReplay} onClick={onClose}>
        {t.close}
      </button>
    </div>
  );
}
