// The move from a card into the room's reader (spec 018): the card grows into the page while the enlarge happens.
//   - With `document.startViewTransition`: the enlarge runs as the transition's update; the card is the named element, and
//     its snapshot is animated from script (Element.animate with `pseudoElement`), so social adds no global CSS. The update
//     ends when the room's context is ready (the caller's `run` resolves then, capped).
//   - Without it: the card itself is animated with `transform` and `clip-path` towards the viewport, then the enlarge runs
//     (the card is unmounted by the navigation, so the animation has to come first).
//   - With prefers-reduced-motion: nothing animates; the enlarge runs at once.
export type TransitionMode = "view-transition" | "fallback" | "none";

export const VIEW_TRANSITION_NAME = "social-enlarge";
/** Length of either animation. */
export const ENLARGE_MS = 300;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

interface ViewTransitionLike {
  ready: Promise<unknown>;
  updateCallbackDone: Promise<unknown>;
}

export interface TransitionEnv {
  startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike;
  /** The element view-transition pseudo-elements hang off (document.documentElement). */
  root: Pick<Element, "animate">;
  reducedMotion(): boolean;
  viewport(): { width: number; height: number };
}

export function browserEnv(): TransitionEnv {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => ViewTransitionLike };
  return {
    startViewTransition: typeof doc.startViewTransition === "function" ? (cb) => doc.startViewTransition!(cb) : undefined,
    root: doc.documentElement,
    reducedMotion: () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  };
}

/** `transform` that takes a box at `rect` onto the whole viewport (origin at its top-left corner). */
export function toViewport(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, vp: { width: number; height: number }) {
  const sx = rect.width > 0 ? vp.width / rect.width : 1;
  const sy = rect.height > 0 ? vp.height / rect.height : 1;
  return `translate(${-rect.left}px, ${-rect.top}px) scale(${sx}, ${sy})`;
}

/** Run `run` (the enlarge) with the card growing into the page; resolves with the mode used once `run` has finished. */
export async function enlargeWithTransition(
  card: HTMLElement,
  run: () => Promise<void>,
  env: TransitionEnv = browserEnv(),
): Promise<TransitionMode> {
  if (env.reducedMotion()) {
    await run();
    return "none";
  }
  const rect = card.getBoundingClientRect();
  const grow = toViewport(rect, env.viewport());

  if (env.startViewTransition) {
    card.style.setProperty("view-transition-name", VIEW_TRANSITION_NAME);
    const vt = env.startViewTransition(async () => {
      card.style.removeProperty("view-transition-name");
      await run();
    });
    vt.ready.then(
      () =>
        env.root.animate(
          [
            { transformOrigin: "0 0", transform: "none", opacity: 1 },
            { transformOrigin: "0 0", transform: grow, opacity: 0 },
          ],
          { duration: ENLARGE_MS, easing: EASING, pseudoElement: `::view-transition-old(${VIEW_TRANSITION_NAME})` },
        ),
      () => undefined, // skipped (for example the update took too long): the enlarge still happened
    );
    await vt.updateCallbackDone.catch(() => undefined);
    return "view-transition";
  }

  if (typeof card.animate === "function") {
    card.style.transformOrigin = "0 0";
    const a = card.animate(
      [
        { transform: "none", clipPath: "inset(0 round 8px)" },
        { transform: grow, clipPath: "inset(0 round 0)" },
      ],
      { duration: ENLARGE_MS, easing: EASING, fill: "forwards" },
    );
    await a.finished.catch(() => undefined);
  }
  await run();
  return "fallback";
}
