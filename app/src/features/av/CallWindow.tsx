import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useInterfaceLang } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { RecordingBadge } from "~/features/recording/RecordingBadge";
import { useCallRecording } from "~/features/recording/use-recording";
import { useChromeInsets } from "./insets";
import { useCallController } from "./use-call";
import {
  area,
  browserStorage,
  dimensions,
  loadPlacement,
  nudge,
  rect,
  savePlacement,
  snap,
  type Corner,
  type Dir,
  type Placement,
  type SizeName,
} from "./window-geometry";
import styles from "./window.module.css";

type Physical = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const PHYSICAL: Physical[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const SIZES: Exclude<SizeName, "custom">[] = ["pill", "small", "medium", "large"];

const toLogical = (p: Physical, dir: Dir): Corner => {
  const [v, h] = p.split("-") as ["top" | "bottom", "left" | "right"];
  return `${v}-${(h === "left") === (dir === "ltr") ? "start" : "end"}`;
};
const toPhysical = (c: Corner, dir: Dir): Physical => {
  const [v, s] = c.split("-") as ["top" | "bottom", "start" | "end"];
  return `${v}-${(s === "start") === (dir === "ltr") ? "left" : "right"}`;
};

/** The frame's size, for what goes inside it (how many tiles, the pill): a window size, or the phone strip (spec 037). */
export type FrameSize = SizeName | "strip";
export const CallWindowSize = createContext<FrameSize>("small");
/** What a frame holds: the call, or a recording's replay (spec 042). */
export type FrameOwner = "call" | "replay";
export const useCallWindowSize = () => useContext(CallWindowSize);

/** The viewport's size, following resizes and rotation. */
export function useViewport() {
  const read = () => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/**
 * The floating call window (spec 035; design 6.2): fixed over the reader, so it never moves the text. Top inline-end by
 * default; dragged by its handle (a real button, so tiles and controls stay clickable) and snapped to a corner on release;
 * resized from the corner away from its anchor; moved by arrow keys and a menu, each move announced; Escape collapses it to
 * the pill. Not a modal: no focus trap. Its place and size are remembered (window-geometry.ts).
 */
export function CallWindow({
  children,
  pill,
  prompt,
  owner = "call",
  label,
  title,
}: {
  children: ReactNode;
  pill: (expand: () => void) => ReactNode;
  prompt?: ReactNode;
  owner?: FrameOwner;
  label?: string;
  title?: string;
}) {
  const t = useStrings();
  const dir: Dir = useInterfaceLang() === "hebrew" ? "rtl" : "ltr";
  const viewport = useViewport();
  const insets = useChromeInsets();
  const [placement, setPlacement] = useState<Placement>(() => loadPlacement(browserStorage()));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState("");
  const recording = useCallRecording(useCallController());
  const gesture = useRef<{ kind: "move" | "resize"; x: number; y: number; width: number } | null>(null);

  const a = area(viewport, insets, dir);
  const dims = dimensions(placement, viewport);
  const box = rect(placement, dims, a, dir);
  const anchoredRight = box.left + box.width / 2 > (a.left + a.right) / 2;

  const commit = useCallback((next: Placement, announce: string) => {
    setPlacement(next);
    savePlacement(browserStorage(), next);
    setStatus(announce);
  }, []);
  const where = (p: Placement) => t.windowWhere[toPhysical(p.corner, dir)];
  const setSize = (size: Exclude<SizeName, "custom">) =>
    commit({ ...placement, size, width: null }, t.windowSized(t.sizes[size]));

  const onPointerDown = (kind: "move" | "resize") => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = { kind, x: e.clientX, y: e.clientY, width: dims.width };
    setDrag({ dx: 0, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === "move") setDrag({ dx, dy });
    else {
      const width = g.width + (anchoredRight ? -dx : dx);
      setPlacement((p) => ({ ...p, size: "custom", width }));
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (!g) return;
    if (g.kind === "move") {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) + Math.abs(dy) < 4) return; // a click on the handle, not a drag
      const next = snap(placement, { ...box, left: box.left + dx, top: box.top + dy }, a, dir);
      commit(next, t.windowMoved(where(next)));
    } else commit(placement, t.windowSized(t.sizes.custom));
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    commit(nudge(placement, m[0], m[1], dims, a, dir), t.windowMoved(t.windowWhere.free));
  };

  const onWindowKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    setMenu(false);
    if (placement.size !== "pill") setSize("pill");
  };

  const pillMode = placement.size === "pill";
  return (
    <CallWindowSize.Provider value={placement.size}>
      <section
        data-call-window=""
        data-window-owner={owner}
        data-size={placement.size}
        data-corner={placement.corner}
        aria-label={label ?? t.callWindow}
        className={`${styles.window} ${drag ? styles.dragging : ""}`}
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
        }}
        onKeyDown={onWindowKey}
      >
        {!pillMode && (
          <div className={styles.bar}>
            <button
              type="button"
              data-action="call-window-handle"
              className={styles.handle}
              aria-label={t.moveCallWindow}
              onPointerDown={onPointerDown("move")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                gesture.current = null;
                setDrag(null);
              }}
              onKeyDown={onHandleKey}
            >
              {title ?? t.call}
            </button>
            {owner === "call" && <RecordingBadge on={recording} />}
            <button
              type="button"
              data-action="call-window-menu"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={t.callWindowMenu}
              onClick={() => setMenu((m) => !m)}
            >
              ⋯
            </button>
          </div>
        )}
        {menu && (
          <div role="menu" aria-label={t.callWindowMenu} className={styles.menu}>
            {PHYSICAL.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                data-move-to={p}
                onClick={() => {
                  setMenu(false);
                  const next = { ...placement, corner: toLogical(p, dir), offsetX: 16, offsetY: 16 };
                  commit(next, t.windowMoved(t.windowWhere[p]));
                }}
              >
                {t.corners[p]}
              </button>
            ))}
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                data-size-to={s}
                aria-current={placement.size === s ? "true" : undefined}
                onClick={() => {
                  setMenu(false);
                  setSize(s);
                }}
              >
                {t.sizes[s]}
              </button>
            ))}
          </div>
        )}
        {prompt}
        <div className={styles.body}>{pillMode ? pill(() => setSize("small")) : children}</div>
        {!pillMode && (
          <button
            type="button"
            data-action="call-window-resize"
            aria-label={t.resizeCallWindow}
            className={`${styles.resize} ${anchoredRight ? styles.resizeLeft : styles.resizeRight}`}
            onPointerDown={onPointerDown("resize")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              const grow = e.key === (anchoredRight ? "ArrowLeft" : "ArrowRight");
              const shrink = e.key === (anchoredRight ? "ArrowRight" : "ArrowLeft");
              if (!grow && !shrink) return;
              e.preventDefault();
              commit({ ...placement, size: "custom", width: dims.width + (grow ? 32 : -32) }, t.windowSized(t.sizes.custom));
            }}
          />
        )}
        <p data-call-window-status="" aria-live="polite" className={styles.status}>
          {status}
        </p>
      </section>
    </CallWindowSize.Provider>
  );
}
