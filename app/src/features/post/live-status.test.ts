// Spec 056 AC-004: the live cards' poller asks only for the cards on screen, in one request every 15 seconds, and never while
// the tab is hidden. A fake environment stands for the viewport (IntersectionObserver) and the page's visibility. Loaded
// through import.meta.glob, so on a base without it the first assertion fails.
// @feature FEED-076 Live cards in posts: the leader's current text, polled only while seen
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LiveStatusModule from "./live-status";

const modules = import.meta.glob<typeof LiveStatusModule>("./live-status.ts");

type Status = LiveStatusModule.LiveStatus;
const status = (id: string, ref: string): Status => ({
  id,
  kind: "room",
  live: true,
  ref,
  heRef: null,
  here: 2,
  updatedAt: "2026-11-25T10:00:00.000Z",
});

function fakeEnv() {
  let hidden = false;
  const onVisible = new Set<() => void>();
  let report: ((entries: { target: object; isIntersecting: boolean }[]) => void) | null = null;
  const env: LiveStatusModule.PollerEnv = {
    isHidden: () => hidden,
    onVisibilityChange(cb) {
      onVisible.add(cb);
      return () => onVisible.delete(cb);
    },
    observe(cb) {
      report = cb;
      return { observe() {}, unobserve() {}, disconnect() {} };
    },
  };
  return {
    env,
    show: (el: object, on: boolean) => report!([{ target: el, isIntersecting: on }]),
    setHidden(h: boolean) {
      hidden = h;
      for (const cb of onVisible) cb();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("spec 056: the live cards' poller", () => {
  // @ac 056/AC-004
  it("asks for the cards on screen in one request every 15 seconds, and sends nothing while the tab is hidden", async () => {
    expect(Object.keys(modules), "features/post/live-status.ts exists").toEqual(["./live-status.ts"]);
    const { LivePoller, POLL_MS } = await modules["./live-status.ts"]!();
    expect(POLL_MS).toBe(15_000);
    const calls: string[][] = [];
    const source = {
      liveStatus: vi.fn(async (ids: string[]) => (calls.push([...ids]), ids.map((id) => status(id, `ref ${id}`)))),
    };
    const fake = fakeEnv();
    const poller = new LivePoller(source, fake.env);
    const seen: Record<string, string | null> = {};
    const els = { a: {}, b: {}, c: {} };
    for (const [id, el] of Object.entries(els)) poller.watch(id, el, (s) => (seen[id] = s.ref));

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls, "nothing is on screen: no request").toEqual([]);

    fake.show(els.a, true);
    fake.show(els.b, true);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls, "cards that come into view are read at once, together").toEqual([["a", "b"]]);
    expect(seen).toEqual({ a: "ref a", b: "ref b" });

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.at(-1)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);

    fake.setHidden(true);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(calls, "hidden tab: no request").toHaveLength(2);

    fake.show(els.b, false);
    fake.show(els.c, true);
    fake.setHidden(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.at(-1), "visible again: read at once, only what is on screen").toEqual(["a", "c"]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.slice(-2)).toEqual([
      ["a", "c"],
      ["a", "c"],
    ]);
    poller.dispose();
  });

  // @ac 056/AC-004
  it("stops while every card is off screen and starts again when one comes back", async () => {
    expect(Object.keys(modules), "features/post/live-status.ts exists").toEqual(["./live-status.ts"]);
    const { LivePoller, POLL_MS } = await modules["./live-status.ts"]!();
    const calls: string[][] = [];
    const source = { liveStatus: vi.fn(async (ids: string[]) => (calls.push([...ids]), ids.map((id) => status(id, "r")))) };
    const fake = fakeEnv();
    const poller = new LivePoller(source, fake.env);
    const el = {};
    poller.watch("a", el, () => {});
    fake.show(el, true);
    await vi.advanceTimersByTimeAsync(100);
    fake.show(el, false);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls).toEqual([["a"]]);
    fake.show(el, true);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([["a"], ["a"]]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toHaveLength(3);
    poller.dispose();
  });

  // @ac 056/AC-004
  it("reads a card that comes into view during a read as soon as that read ends", async () => {
    expect(Object.keys(modules), "features/post/live-status.ts exists").toEqual(["./live-status.ts"]);
    const { LivePoller } = await modules["./live-status.ts"]!();
    const calls: string[][] = [];
    let release: () => void = () => {};
    const source = {
      liveStatus: vi.fn(async (ids: string[]) => {
        calls.push([...ids]);
        if (calls.length === 1) await new Promise<void>((r) => (release = r));
        return ids.map((id) => status(id, "r"));
      }),
    };
    const fake = fakeEnv();
    const poller = new LivePoller(source, fake.env);
    const a = {};
    const b = {};
    poller.watch("a", a, () => {});
    poller.watch("b", b, () => {});
    fake.show(a, true);
    await vi.advanceTimersByTimeAsync(100);
    fake.show(b, true); // while the first read is under way
    await vi.advanceTimersByTimeAsync(1_000);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([["a"], ["a", "b"]]);
    poller.dispose();
  });

  // @ac 056/AC-004
  it("splits more than 50 visible cards into requests of 50", async () => {
    expect(Object.keys(modules), "features/post/live-status.ts exists").toEqual(["./live-status.ts"]);
    const { LivePoller, POLL_MS } = await modules["./live-status.ts"]!();
    const sizes: number[] = [];
    const source = { liveStatus: vi.fn(async (ids: string[]) => (sizes.push(ids.length), [])) };
    const fake = fakeEnv();
    const poller = new LivePoller(source, fake.env);
    for (let i = 0; i < 60; i++) {
      const el = {};
      poller.watch(`id${i}`, el, () => {});
      fake.show(el, true);
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(sizes).toEqual([50, 10]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(sizes).toEqual([50, 10, 50, 10]);
    poller.dispose();
  });
});
