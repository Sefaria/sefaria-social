// @vitest-environment jsdom
// Spec 018: the card grows into the page — a view transition where the browser has one, transform and clip-path otherwise,
// nothing with reduced motion. The module loads through import.meta.glob so that, on a base without it, the first assertion
// fails.
import { describe, expect, it, vi } from "vitest";
import type * as TransitionModule from "./enlarge-transition";

const mods = import.meta.glob<typeof TransitionModule>("./enlarge-transition.ts");
const load = async () => {
  const mod = await mods["./enlarge-transition.ts"]?.();
  expect(mod, "app/src/features/feed/enlarge-transition.ts exists").toBeDefined();
  return mod!;
};

function card() {
  const el = document.createElement("article");
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect;
  document.body.append(el);
  return el;
}

describe("enlarge transition", () => {
  // @feature FEED-018 Enlarge from a card with a view transition
  // @ac 018/AC-002
  it("runs the enlarge as a view transition's update with the card as the named element, then grows its snapshot", async () => {
    const { enlargeWithTransition, VIEW_TRANSITION_NAME } = await load();
    const el = card();
    const events: string[] = [];
    const animate = vi.fn((_k: Keyframe[], _o: KeyframeAnimationOptions) => ({}) as Animation);
    const mode = await enlargeWithTransition(
      el,
      async () => {
        events.push(`run name=${el.style.getPropertyValue("view-transition-name") || "(none)"}`);
      },
      {
        startViewTransition: (update) => {
          events.push(`start name=${el.style.getPropertyValue("view-transition-name")}`);
          const done = update();
          return { ready: done, updateCallbackDone: done };
        },
        root: { animate } as unknown as Element,
        reducedMotion: () => false,
        viewport: () => ({ width: 1000, height: 800 }),
      },
    );
    expect(mode).toBe("view-transition");
    expect(events).toEqual([`start name=${VIEW_TRANSITION_NAME}`, "run name=(none)"]);
    await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
    const [frames, options] = animate.mock.calls[0]!;
    expect(options.pseudoElement).toBe(`::view-transition-old(${VIEW_TRANSITION_NAME})`);
    expect(frames.at(-1)?.transform).toBe("translate(-100px, -50px) scale(5, 8)");
  });

  // @feature FEED-018 Enlarge from a card with a view transition
  // @ac 018/AC-002
  it("without view transitions, animates the card with transform and clip-path first, then enlarges", async () => {
    const { enlargeWithTransition, ENLARGE_MS } = await load();
    const el = card();
    const events: string[] = [];
    el.animate = vi.fn((frames: Keyframe[], options?: KeyframeAnimationOptions) => {
      events.push(`animate ${Object.keys(frames[1]!).sort().join(",")} ${(options as { duration: number }).duration}`);
      return { finished: Promise.resolve() } as unknown as Animation;
    }) as unknown as typeof el.animate;
    const mode = await enlargeWithTransition(el, async () => void events.push("run"), {
      root: { animate: vi.fn() } as unknown as Element,
      reducedMotion: () => false,
      viewport: () => ({ width: 1000, height: 800 }),
    });
    expect(mode).toBe("fallback");
    expect(events).toEqual([`animate clipPath,transform ${ENLARGE_MS}`, "run"]);
    expect(ENLARGE_MS).toBeLessThanOrEqual(300);
  });

  // @feature FEED-018 Enlarge from a card with a view transition
  // @ac 018/AC-003
  it("with reduced motion runs no animation and no view transition, and enlarges at once", async () => {
    const { enlargeWithTransition } = await load();
    const el = card();
    const start = vi.fn();
    const rootAnimate = vi.fn();
    el.animate = vi.fn() as unknown as typeof el.animate;
    const run = vi.fn(async () => undefined);
    const mode = await enlargeWithTransition(el, run, {
      startViewTransition: start,
      root: { animate: rootAnimate } as unknown as Element,
      reducedMotion: () => true,
      viewport: () => ({ width: 1000, height: 800 }),
    });
    expect(mode).toBe("none");
    expect([run.mock.calls.length, start.mock.calls.length, rootAnimate.mock.calls.length]).toEqual([1, 0, 0]);
    expect(vi.mocked(el.animate).mock.calls).toEqual([]);
  });
});
