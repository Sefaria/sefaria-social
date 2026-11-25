// @vitest-environment jsdom
// Spec 055: a room, broadcast or recording link in the composer becomes a card (AC-001), URLs in a post are links (AC-004), and
// a post's card shows the target with one button through the host (AC-005). Modules load through import.meta.glob, so on a base
// without them the first assertion fails.
// @feature FEED-075 Links in post text, and a session card in the composer and in posts
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { SocialApiContext, type SocialApi } from "~/features/api/social-api";
import { HostContext } from "~/features/host/host-context";
import type * as ComposerModule from "./Composer";
import type * as EmbedCardModule from "./EmbedCard";
import type * as LinkifyModule from "./linkify";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const composerModules = import.meta.glob<typeof ComposerModule>("./Composer.tsx");
const cardModules = import.meta.glob<typeof EmbedCardModule>("./EmbedCard.tsx");
const linkifyModules = import.meta.glob<typeof LinkifyModule>("./linkify.tsx");
const ROOM = "0b6f8f7e-3f43-4a36-9b8e-7e1f6c2a9d10";
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function mount(el: ReactElement, api: Partial<SocialApi> = {}) {
  const fake = createFakeHost();
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  await act(async () =>
    root.render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(SocialApiContext.Provider, { value: api as SocialApi }, el),
      ),
    ),
  );
  cleanup.push(() => {
    act(() => root.unmount());
    box.remove();
  });
  return { box, fake };
}

async function type(area: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("spec 055: links in posts", () => {
  // @ac 055/AC-001
  it("turns a pasted room link into a card under the text, and Remove puts the link back", async () => {
    expect(composerModules["./Composer.tsx"], "Composer exists").toBeDefined();
    const { Composer } = await composerModules["./Composer.tsx"]!();
    const createPost = vi.fn(async (input: object) => ({ id: "p1", ...input }) as never);
    const me = vi.fn(async () => ({ id: "me", name: "Me", administers: [] }) as never);
    const { box } = await mount(createElement(Composer, { onPosted: () => {} }), { createPost, me });
    const area = box.querySelector<HTMLTextAreaElement>("[data-composer-body]")!;
    const link = `https://www.sefaria.org/social/r/${ROOM}`;

    await type(area, `Join us ${link}`);
    const card = box.querySelector("[data-composer-embed]");
    expect([area.value, card?.getAttribute("data-composer-embed")]).toEqual(["Join us ", "room"]);
    expect(card?.querySelector("[data-action=remove-embed]")).not.toBeNull();

    await type(area, `Join us and https://www.sefaria.org/social/b/${ROOM}`);
    expect([box.querySelectorAll("[data-composer-embed]").length, area.value]).toEqual([
      1,
      `Join us and https://www.sefaria.org/social/b/${ROOM}`,
    ]);

    await type(area, "Join us ");
    await act(async () => box.querySelector<HTMLButtonElement>("[data-action=remove-embed]")!.click());
    expect([area.value, box.querySelector("[data-composer-embed]")]).toEqual([`Join us ${link}`, null]);

    await type(area, `/social/rec/${ROOM}`);
    expect([area.value, box.querySelector("[data-composer-embed]")?.getAttribute("data-composer-embed")]).toEqual([
      "",
      "recording",
    ]);
    await act(async () => box.querySelector<HTMLButtonElement>("[data-action=post]")!.click());
    expect(createPost).toHaveBeenCalledWith({ body: "", embed: { kind: "recording", id: ROOM } });
  });

  // @ac 055/AC-004
  it("renders http and https URLs in a post as links that open a new tab, and leaves other schemes as text", async () => {
    expect(linkifyModules["./linkify.tsx"], "linkify exists").toBeDefined();
    const { Linkified } = await linkifyModules["./linkify.tsx"]!();
    const { box } = await mount(
      createElement(Linkified, { text: "see https://example.org/a?b=1, http://x.test/y and javascript:alert(1)" }),
    );
    const links = [...box.querySelectorAll("a")].map((a) => [
      a.getAttribute("href"),
      a.textContent,
      a.getAttribute("rel"),
      a.getAttribute("target"),
    ]);
    expect(links).toEqual([
      ["https://example.org/a?b=1", "https://example.org/a?b=1", "noopener nofollow", "_blank"],
      ["http://x.test/y", "http://x.test/y", "noopener nofollow", "_blank"],
    ]);
    expect(box.textContent).toBe("see https://example.org/a?b=1, http://x.test/y and javascript:alert(1)");
  });

  // @ac 055/AC-005
  it("shows the target's title, leader and one button that goes there through the host; a missing target has none", async () => {
    expect(cardModules["./EmbedCard.tsx"], "EmbedCard exists").toBeDefined();
    const { EmbedCard } = await cardModules["./EmbedCard.tsx"]!();
    const kinds = [
      { kind: "room", label: "Join", path: `/social/r/${ROOM}` },
      { kind: "broadcast", label: "Watch", path: `/social/b/${ROOM}` },
      { kind: "recording", label: "Play", path: `/social/rec/${ROOM}` },
    ] as const;
    for (const k of kinds) {
      const { box, fake } = await mount(
        createElement(EmbedCard, { embed: { kind: k.kind, id: ROOM, title: "Daf Yomi together", leader: "Rav Owner" } }),
      );
      const card = box.querySelector("[data-embed-card]")!;
      const button = card.querySelector<HTMLAnchorElement>("[data-embed-action]")!;
      expect([
        card.getAttribute("data-embed-card"),
        card.querySelector("[data-embed-title]")?.textContent,
        card.querySelector("[data-embed-leader]")?.textContent,
        button.textContent,
        button.getAttribute("href"),
      ]).toEqual([k.kind, "Daf Yomi together", "with Rav Owner", k.label, k.path]);
      await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
      expect(fake.calls.navigate.map((n) => n.to)).toEqual([k.path]);
    }
    const { box } = await mount(createElement(EmbedCard, { embed: { kind: "room", id: ROOM, title: null, leader: null } }));
    expect([
      box.querySelector("[data-embed-card]")?.getAttribute("data-embed-unavailable"),
      box.querySelector("[data-embed-action]"),
    ]).toEqual(["", null]);
  });
});
