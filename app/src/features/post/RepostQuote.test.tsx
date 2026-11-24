// @vitest-environment jsdom
// Spec 030 AC-004: the card's repost button (pressed state and count at once, restored if the server refuses) and the quote form
// (posts a quote carrying the post). Loaded through import.meta.glob, so on a base without them the first assertion fails.
// @feature FEED-071 Quote a post
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SocialApiModule from "~/features/api/social-api";
import type * as RepostModule from "./RepostButton";
import type * as QuoteModule from "./QuoteComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SocialApi = SocialApiModule.SocialApi;
const apiModules = import.meta.glob<typeof SocialApiModule>("../api/social-api.ts");
const repostModules = import.meta.glob<typeof RepostModule>("./RepostButton.tsx");
const quoteModules = import.meta.glob<typeof QuoteModule>("./QuoteComposer.tsx");
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function mount(api: Partial<SocialApi>, el: ReturnType<typeof createElement>) {
  expect(apiModules["../api/social-api.ts"], "features/api/social-api.ts exists").toBeDefined();
  const { SocialApiContext } = await apiModules["../api/social-api.ts"]!();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(SocialApiContext.Provider, { value: api as SocialApi }, el)));
  cleanup.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

describe("repost and quote on the card", () => {
  // @ac 030/AC-004
  it("repost shows pressed with the new count at once, and comes back if the server refuses", async () => {
    expect(repostModules["./RepostButton.tsx"], "RepostButton exists").toBeDefined();
    const { RepostButton } = await repostModules["./RepostButton.tsx"]!();
    let refuse = false;
    const repost = vi.fn(async (_id: string, on: boolean) => {
      if (refuse) throw new Error("no");
      return { reposted: on, repostCount: on ? 3 : 2 };
    });
    const el = await mount({ repost }, createElement(RepostButton, { postId: "p1", reposted: false, count: 2 }));
    const button = el.querySelector<HTMLButtonElement>("[data-action=repost]")!;
    await act(async () => button.click());
    expect([button.getAttribute("aria-pressed"), el.querySelector("[data-repost-count]")!.textContent]).toEqual(["true", "3"]);
    expect(repost).toHaveBeenCalledWith("p1", true);
    refuse = true;
    await act(async () => button.click());
    expect([button.getAttribute("aria-pressed"), el.querySelector("[data-repost-count]")!.textContent]).toEqual(["true", "3"]);
    expect(el.querySelector("[role=alert]")).not.toBeNull();
  });

  // @ac 030/AC-004
  it("the quote form posts the learner's words carrying the post", async () => {
    expect(quoteModules["./QuoteComposer.tsx"], "QuoteComposer exists").toBeDefined();
    const { QuoteComposer } = await quoteModules["./QuoteComposer.tsx"]!();
    const createPost = vi.fn(async (input: { body: string; quotedPostId?: string }) => ({ id: "q1", ...input }) as never);
    const onPosted = vi.fn();
    const onDone = vi.fn();
    const el = await mount({ createPost }, createElement(QuoteComposer, { postId: "p1", onDone, onPosted }));
    const area = el.querySelector<HTMLTextAreaElement>("[data-quote-body]")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(area, "  Next to the Ramban  ");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => el.querySelector<HTMLButtonElement>("[data-action=post-quote]")!.click());
    expect(createPost).toHaveBeenCalledWith({ body: "Next to the Ramban", quotedPostId: "p1" });
    expect(onPosted).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
