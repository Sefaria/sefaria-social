// @vitest-environment jsdom
// Spec 015: the feed page — three sections in order, polling, the signed-out prompt, the error alert, Hebrew. Rendered with
// the fake host and a fake feed API that has the real one's method. Modules load through import.meta.glob so that, on a
// base without them, the first assertion fails.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SupportModule from "./test-feed";

const mods = import.meta.glob<typeof SupportModule>("./test-feed.tsx");
const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.useRealTimers();
});

async function loadSupport() {
  const support = await mods["./test-feed.tsx"]?.();
  expect(support, "app/src/features/feed/test-feed.tsx (and the feed) exist").toBeDefined();
  return support!;
}

async function setup(opts: SupportModule.FeedSetup | ((s: typeof SupportModule) => SupportModule.FeedSetup) = {}) {
  const support = await loadSupport();
  const r = await support.renderFeed(typeof opts === "function" ? opts(support) : opts);
  teardown.push(r.unmount);
  return { ...r, support };
}

const headings = (el: HTMLElement) => [...el.querySelectorAll("[data-social-page=feed] h2")].map((h) => h.textContent);

describe("the rail's ways into rooms (spec 044)", () => {
  // @feature ROOM-046 Start a room from Social and land in its lobby
  // @ac 044/AC-007
  it("offers Start a room and All rooms to a signed-in reader, and says when they are in no room yet", async () => {
    const { el } = await setup({ feed: { live: [], scheduled: [], recent: [] } });
    await vi.waitFor(() => expect(el.querySelector("[data-feed-state]")?.getAttribute("data-feed-state")).toBe("ready"));
    const bar = el.querySelector("[data-rooms-bar]");
    expect(bar?.querySelector("[data-action=start-room]")?.textContent).toBe("Start a room");
    expect(bar?.querySelector("a")?.getAttribute("href")).toContain("/social/rooms");
    expect(el.querySelector("[data-rooms-empty]")?.textContent).toContain("You are not in any room yet.");
  });
});

describe("the feed page", () => {
  // @feature FEED-051 Feed page at /social
  // @ac 015/AC-003
  it("shows Live now, Scheduled and Recent in that order, says when a section is empty, and reads again every 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { el, api, support } = await setup((s) => ({ feed: { ...s.FEED, scheduled: [] } }));
    await vi.waitFor(() => expect(el.querySelector("[data-feed-state]")?.getAttribute("data-feed-state")).toBe("ready"));
    expect(headings(el)).toEqual(["Live now", "Scheduled", "Recent"]);
    expect(el.querySelector("[data-feed-section=scheduled] p")?.textContent).toBe("Nothing is scheduled yet.");
    expect(el.querySelectorAll("[data-feed-section=live] [data-feed-card]")).toHaveLength(support.FEED.live.length);
    expect(vi.mocked(api.getFeed).mock.calls).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(vi.mocked(api.getFeed).mock.calls).toHaveLength(2);
  });

  // @feature FEED-051 Feed page at /social
  // @ac 015/AC-004
  it("signed out: asks the reader to sign in and requests nothing", async () => {
    const { el, api, fake } = await setup({ host: { viewer: null } });
    expect(el.querySelector("[data-feed-state]")?.getAttribute("data-feed-state")).toBe("signed-out");
    expect(el.querySelector("[data-social-page=feed] p")?.textContent).toBe("Sign in to see your rooms and shiurim.");
    await act(async () => el.querySelector<HTMLButtonElement>("button[data-action=sign-in]")!.click());
    expect(fake.calls.signIn).toBe(1);
    expect(vi.mocked(api.getFeed).mock.calls).toEqual([]);
  });

  // @feature FEED-051 Feed page at /social
  // @ac 015/AC-004
  it("says the feed could not be loaded in an alert, rather than showing an empty feed", async () => {
    const { el } = await setup({ feed: () => Promise.reject(new Error("social API answered 503")) });
    await vi.waitFor(() =>
      expect(el.querySelector("[role=alert]")?.textContent).toBe("The feed could not be loaded. Try again in a moment."),
    );
    expect(headings(el)).toEqual([]);
  });

  // @feature FEED-051 Feed page at /social
  // @ac 015/AC-005
  it("in Hebrew: headings in Hebrew inside lang he and dir rtl, and each section's cards are list items", async () => {
    const { el } = await setup({ host: { ui: { interfaceLang: "hebrew" } } });
    await vi.waitFor(() => expect(headings(el)).toEqual(["בשידור חי", "מתוכנן", "לאחרונה"]));
    const root = el.querySelector("[data-social-page=feed]")!;
    expect([root.getAttribute("lang"), root.getAttribute("dir")]).toEqual(["he", "rtl"]);
    const cards = [...el.querySelectorAll("[data-feed-card]")];
    expect(cards.map((c) => [c.parentElement?.tagName, c.parentElement?.parentElement?.tagName])).toEqual(
      cards.map(() => ["LI", "UL"]),
    );
  });
});
