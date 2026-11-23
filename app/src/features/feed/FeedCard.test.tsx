// @vitest-environment jsdom
// Specs 016, 017 (press) and 018 (enlarge) at component level: the light card's markup, its status in words, no socket for a
// feed of live cards, the press that prepares a room, and the click that enlarges onto the card's source. The fake host plays
// the reader; the test relay runs the real room and counts sockets. Modules load through import.meta.glob so that, on a base
// without them, the first assertion fails.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SupportModule from "./test-feed";
import type * as RelayModule from "~/features/session/test-relay";
import type * as ControllerModule from "~/features/session/controller";
import type * as LinkModule from "~/features/host/ReaderRefLink";

const mods = {
  support: import.meta.glob<typeof SupportModule>("./test-feed.tsx"),
  relay: import.meta.glob<typeof RelayModule>("../session/test-relay.ts"),
  controller: import.meta.glob<typeof ControllerModule>("../session/controller.ts"),
  link: import.meta.glob<typeof LinkModule>("../host/ReaderRefLink.tsx"),
};

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.useRealTimers();
});

async function setup(opts: SupportModule.FeedSetup = {}) {
  const support = await mods.support["./test-feed.tsx"]?.();
  expect(support, "app/src/features/feed/test-feed.tsx (and the feed) exist").toBeDefined();
  const { installTestRelay } = (await mods.relay["../session/test-relay.ts"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());
  const r = await support!.renderFeed(opts);
  const { roomControllerFor } = (await mods.controller["../session/controller.ts"]!())!;
  teardown.push(() => roomControllerFor(r.fake.host).dispose());
  teardown.push(r.unmount);
  await vi.waitFor(() => expect(r.el.querySelector("[data-feed-state]")?.getAttribute("data-feed-state")).toBe("ready"));
  const card = (id: string) => r.el.querySelector<HTMLElement>(`[data-feed-card][data-id="${id}"]`)!;
  const link = (id: string) => card(id).querySelector<HTMLAnchorElement>("a")!;
  return { ...r, relay, support: support!, card, link };
}

describe("a light card", () => {
  // @feature FEED-016 Light card: article with one stretched link and status in words
  // @ac 016/AC-001
  it("is an article labelled by its heading, whose only link is in the heading and points at the lobby or the shiur page", async () => {
    const { el, support, fake, link } = await setup();
    const { ROOMS, SHIUR } = support;
    const cards = [...el.querySelectorAll<HTMLElement>("[data-feed-card]")];
    expect(cards.map((c) => c.tagName)).toEqual(cards.map(() => "ARTICLE"));
    expect(cards.map((c) => document.getElementById(c.getAttribute("aria-labelledby")!)?.tagName)).toEqual(cards.map(() => "H3"));
    expect(cards.map((c) => [c.querySelectorAll("a").length, c.querySelector("a")?.parentElement?.tagName])).toEqual(
      cards.map(() => [1, "H3"]),
    );
    expect(cards.map((c) => c.querySelector("a")!.getAttribute("href"))).toEqual([
      `/social/r/${ROOMS.bereshit}`,
      `/social/r/${ROOMS.shemot}`,
      `/social/r/${ROOMS.tehillim}`,
      `/social/s/${SHIUR}`,
      `/social/r/${ROOMS.mishnah}`,
    ]);
    // A plain click on a room that is not live, or on a shiur, goes to its page through the host.
    await act(async () => link(ROOMS.mishnah).click());
    await act(async () => link(SHIUR).click());
    expect(fake.calls.navigate.map((n) => [n.to, n.replace])).toEqual([
      [`/social/r/${ROOMS.mishnah}`, false],
      [`/social/s/${SHIUR}`, false],
    ]);
  });

  // @feature FEED-016 Light card: article with one stretched link and status in words
  // @ac 016/AC-002
  it("says its status in words, keeps the dot decorative, and shows the ref in the interface language", async () => {
    const { card, support } = await setup({ host: { ui: { interfaceLang: "hebrew" } } });
    const { ROOMS, SHIUR } = support;
    const MISHNAH = ROOMS.mishnah;
    const status = (id: string) => card(id).querySelector("[data-card-status]")!;
    expect(status(ROOMS.bereshit).textContent).toBe("פעיל עכשיו · 3 לומדים");
    expect(status(ROOMS.bereshit).querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(status(MISHNAH).textContent).toBe("לא פעיל כרגע");
    expect(status(SHIUR).querySelector("time")?.getAttribute("datetime")).toBe("2030-01-01T18:00:00.000Z");
    const where = (id: string) => card(id).querySelector("[data-card-ref]")!;
    expect([
      where(ROOMS.bereshit).textContent,
      where(ROOMS.bereshit).getAttribute("lang"),
      where(ROOMS.bereshit).getAttribute("dir"),
    ]).toEqual(["בראשית א׳", "he", "rtl"]);
    // No heRef known: the English ref, marked as English.
    expect([where(ROOMS.tehillim).textContent, where(ROOMS.tehillim).getAttribute("lang")]).toEqual(["Psalms 23", "en"]);
  });

  // @feature FEED-052 A feed of live cards opens no sockets
  // @ac 016/AC-003
  it("a feed of three live cards opens no socket and mounts no reader", async () => {
    const { el, relay, fake } = await setup();
    await vi.waitFor(() => expect(el.querySelectorAll("[data-feed-section=live] [data-source-text=ready]")).toHaveLength(3));
    expect(el.querySelectorAll("[data-feed-card=live]")).toHaveLength(3);
    expect(relay.opened).toEqual([]);
    expect([fake.calls.navigate, fake.calls.applied, fake.calls.go]).toEqual([[], [], []]);
  });

  // @feature FEED-053 Prefetch on visibility and on press
  // @ac 017/AC-004
  it("a press prepares the room (one socket), released after 10 seconds without an enlarge", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { relay, link, support } = await setup();
    const { ROOMS } = support;
    expect(relay.opened).toEqual([]);
    await act(async () => link(ROOMS.shemot).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await vi.waitFor(() => expect(relay.open(ROOMS.shemot)).toBe(1));
    expect(relay.opened.map((o) => o.url)).toEqual([`ws://localhost:8787/r/${ROOMS.shemot}`]);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await vi.waitFor(() => expect(relay.open(ROOMS.shemot)).toBe(0));
  });

  // @feature FEED-018 Enlarge from a card with a view transition
  // @ac 018/AC-001
  it("a click on a live card enlarges onto the room's place; with nobody publishing, onto the card's ref", async () => {
    const { relay, link, fake, support } = await setup();
    const { ROOMS } = support;
    const { refWorkspace } = (await mods.link["../host/ReaderRefLink.tsx"]!())!;
    const leader = relay.peer(ROOMS.bereshit, "5151", "Leader");
    leader.send({
      ch: "state",
      body: {
        type: "keyframe",
        seq: 0,
        t: 0,
        snapshot: { v: 1, url: "/Genesis.1", nav: null, slices: { "sefaria.scroll": { v: 1, value: { seg: 2 } } } },
      },
    });
    await act(async () => link(ROOMS.bereshit).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await act(async () => link(ROOMS.bereshit).click());
    await vi.waitFor(() => expect(fake.calls.applied.at(-1)?.snapshot.url).toBe("/Genesis.1"));
    expect(fake.calls.navigate.map((n) => [n.to, n.replace])).toEqual([[`/Genesis.1?ctx=social.room.${ROOMS.bereshit}`, false]]);
    expect(relay.open(ROOMS.bereshit)).toBe(1); // the prepared socket, kept by the enlarge

    // A second feed (the viewer went Back), and a live room whose stream has no state yet: the card's ref is the target.
    fake.back();
    await vi.waitFor(() => expect(fake.url()).toBe("/social"));
    await act(async () => link(ROOMS.tehillim).click());
    const fallback = fake.host.reader.commands.href(refWorkspace("Psalms 23"));
    await vi.waitFor(() => expect(fake.calls.navigate.at(-1)?.to).toBe(`${fallback}?ctx=social.room.${ROOMS.tehillim}`), {
      timeout: 4_000,
    });
  });

  // @feature FEED-018 Enlarge from a card with a view transition
  // @ac 018/AC-004
  it("a modified click is left to the browser: no enlarge, no navigation by the host", async () => {
    const { relay, link, fake, support } = await setup();
    const { ROOMS } = support;
    // After the card's own handler has run, note whether it prevented the browser's default, then stop jsdom navigating.
    const prevented: boolean[] = [];
    const note = (e: Event) => {
      prevented.push(e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener("click", note);
    teardown.push(() => document.removeEventListener("click", note));
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])
      link(ROOMS.bereshit).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }));
    expect(prevented).toEqual([false, false, false, false, false]); // the browser would follow the link
    expect([fake.calls.navigate, relay.opened]).toEqual([[], []]);
  });
});
