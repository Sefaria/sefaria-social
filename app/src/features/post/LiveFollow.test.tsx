// @vitest-environment jsdom
// Spec 032 AC-004: a post sharing a follow-me link shows where the session's leader is now (asking the API, no socket), follows
// them when they move, offers "Join the shiur" (the reader address with `follow=<id>`, pushed through host.navigate), and
// says when the session has ended. Loaded through import.meta.glob, so on a base without it the first assertion fails.
// @feature FEED-075 Join a live shiur from the feed
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as SocialApiModule from "~/features/api/social-api";
import { HostContext } from "~/features/host/host-context";
import type { TextSource } from "~/lib/sefaria-text";
import { TextSourceContext } from "~/ui/SourceText";
import type * as LiveModule from "./LiveFollow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiModules = import.meta.glob<typeof SocialApiModule>("../api/social-api.ts");
const liveModules = import.meta.glob<typeof LiveModule>("./LiveFollow.tsx");
const SESSION = "Ab3".repeat(14) + "Z";
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  vi.useRealTimers();
});

const texts: TextSource = {
  get: async (ref) => ({ blocks: [{ lang: "en", dir: "ltr", segments: [`text of ${ref}`] }] }) as never,
  prefetch: () => {},
  titles: () => null,
  subscribe: () => () => {},
  requests: () => ({}),
};

type Status = { live: boolean; away?: boolean; ref: string | null; leader: string | null; participants: number };

async function mount(answers: Status[]) {
  expect(liveModules["./LiveFollow.tsx"], "features/post/LiveFollow.tsx exists").toBeDefined();
  const { LiveFollow } = await liveModules["./LiveFollow.tsx"]!();
  const { SocialApiContext } = await apiModules["../api/social-api.ts"]!();
  const followStatus = vi.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0]!));
  const fake = createFakeHost();
  const post = { id: "p1", body: "Join me", ref: "Exodus 3:1", followSessionId: SESSION } as SocialApiModule.Post;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(
          SocialApiContext.Provider,
          { value: { followStatus } as unknown as SocialApiModule.SocialApi },
          createElement(TextSourceContext.Provider, { value: texts }, createElement(LiveFollow, { post, sessionId: SESSION })),
        ),
      ),
    ),
  );
  await act(async () => {});
  cleanup.push(() => {
    act(() => root.unmount());
    el.remove();
  });
  return { el, fake, followStatus, LIVE_POLL_MS: (await liveModules["./LiveFollow.tsx"]!()).LIVE_POLL_MS };
}

describe("a shared follow-me session on the card", () => {
  // @ac 032/AC-004
  it("shows the leader's place now, follows them when they move, and joins through the reader's follow link", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el, fake, followStatus, LIVE_POLL_MS } = await mount([
      { live: true, ref: "Exodus 3:2", leader: "Rav Levi", participants: 4 },
      { live: true, away: true, ref: "Exodus 3:5", leader: "Rav Levi", participants: 5 },
    ]);
    const fig = el.querySelector("figure")!;
    expect([fig.dataset.follow, fig.dataset.postSource]).toEqual(["live", "Exodus 3:2"]);
    expect(fig.textContent).toContain("Rav Levi is learning");
    expect(fig.textContent).toContain("text of Exodus 3:2");
    const join = el.querySelector<HTMLAnchorElement>("[data-follow-join]")!;
    expect(join.getAttribute("href")).toMatch(new RegExp(`[?&]follow=${SESSION}$`));

    await act(async () => {
      vi.advanceTimersByTime(LIVE_POLL_MS);
    });
    await act(async () => {});
    expect(followStatus).toHaveBeenCalledTimes(2);
    expect(el.querySelector("figure")!.dataset.postSource).toBe("Exodus 3:5");
    expect(el.textContent).toContain("text of Exodus 3:5");
    expect(el.textContent).toContain("Rav Levi stepped away for a moment"); // a hidden tab is not the end of the shiur

    const joinNow = el.querySelector<HTMLAnchorElement>("[data-follow-join]")!;
    await act(async () => joinNow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(fake.calls.navigate.at(-1)?.to).toBe(joinNow.getAttribute("href"));
    expect(fake.calls.navigate.at(-1)?.replace ?? false).toBe(false);
  });

  // @ac 032/AC-004
  it("says the session has ended, keeps the post's own source and offers no join", async () => {
    const { el } = await mount([{ live: false, ref: null, leader: null, participants: 0 }]);
    const fig = el.querySelector("figure")!;
    expect([fig.dataset.follow, fig.dataset.postSource]).toEqual(["ended", "Exodus 3:1"]);
    expect(fig.textContent).toContain("This session has ended");
    expect(el.querySelector("[data-follow-join]")).toBeNull();
  });
});
