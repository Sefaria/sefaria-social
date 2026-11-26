// @vitest-environment jsdom
// Spec 063 AC-007: Claude assets in the interface — a profile's public assets with Open in a new tab, the viewer's own with
// upload (and the problems of a refused file) and Publish (and why it was refused), and an asset as a post's card. Modules
// load through import.meta.glob, so on a base without them the first assertion fails.
// @feature FEED-077 Claude assets as post cards and on profile and shiur pages
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { SocialApiContext, SocialApiError, type SocialApi } from "~/features/api/social-api";
import { HostContext } from "~/features/host/host-context";
import type * as AssetsModule from "./ClaudeAssets";
import type * as EmbedCardModule from "~/features/post/EmbedCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assetModules = import.meta.glob<typeof AssetsModule>("./ClaudeAssets.tsx");
const cardModules = import.meta.glob<typeof EmbedCardModule>("../post/EmbedCard.tsx");
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const B = "0b6f8f7e-3f43-4a36-9b8e-7e1f6c2a9d10";
const CONTENT = "https://assets.example.test/api/v1/claude-assets/content/11111111-2222-4333-8444-555555555555";

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
  return box;
}

const mine = (over: Record<string, unknown> = {}) => ({
  id: B,
  title: "The Seven Days",
  description: "",
  lang: "en",
  sourceUrl: null,
  author: { name: "Me", profileId: null, verified: false },
  currentVersionId: "v2",
  publishedVersionId: null,
  publishedAt: null,
  versions: [
    { id: "v1", n: 1, sha256: "a".repeat(64), bytes: 1, createdAt: "2026-11-27T00:00:00Z", contentUrl: `${CONTENT}1` },
    { id: "v2", n: 2, sha256: "b".repeat(64), bytes: 1, createdAt: "2026-11-27T00:00:00Z", contentUrl: `${CONTENT}2` },
  ],
  manifest: null,
  createdAt: "2026-11-27T00:00:00Z",
  updatedAt: "2026-11-27T00:00:00Z",
  hidden: false,
  ...over,
});

describe("spec 063: Claude assets in the interface", () => {
  // @ac 063/AC-007
  it("lists a profile's assets with Open in a new tab; on one's own page, upload shows problems and Publish says why it failed", async () => {
    expect(assetModules["./ClaudeAssets.tsx"], "ClaudeAssets exists").toBeDefined();
    const { ProfileAssets, OwnAssets } = await assetModules["./ClaudeAssets.tsx"]!();
    const profileAssets = vi.fn(async () => [
      {
        id: B,
        title: "The Seven Days",
        description: "A scrolling story of creation.",
        refs: ["Genesis 1:1-5"],
        versionId: "v1",
        contentUrl: CONTENT,
        publishedAt: "2026-11-27T00:00:00Z",
      },
    ]);
    const box = await mount(createElement(ProfileAssets, { profileId: "p1" }), { profileAssets });
    await vi.waitFor(() => expect(box.querySelector("[data-claude-asset]")).not.toBeNull());
    const open = box.querySelector<HTMLAnchorElement>("[data-action=open-asset]")!;
    expect([open.getAttribute("href"), open.target, open.rel, open.textContent]).toEqual([
      CONTENT,
      "_blank",
      "noopener noreferrer",
      "Open",
    ]);
    expect(box.querySelector("[data-claude-asset]")!.textContent).toContain("A scrolling story of creation.");

    const publishAsset = vi.fn(async () => {
      throw new SocialApiError(403, "asset.not_verified");
    });
    const saveAsset = vi.fn(async () => ({
      ok: false as const,
      problems: [{ code: "ref.invalid", ref: "Genesis 99:1", message: '"Genesis 99:1" is not a ref Sefaria knows.' }],
    }));
    const own = await mount(createElement(OwnAssets), {
      myAssets: vi.fn(async () => [mine()]) as never,
      publishAsset,
      saveAsset,
    });
    await vi.waitFor(() => expect(own.querySelector("[data-action=publish-asset]")).not.toBeNull());
    expect(own.querySelector("[data-action=publish-asset]")!.textContent).toBe("Publish version 2");
    await act(async () => own.querySelector<HTMLButtonElement>("[data-action=publish-asset]")!.click());
    expect(publishAsset).toHaveBeenCalledWith(B, true);
    await vi.waitFor(() =>
      expect(own.querySelector("[data-asset-message]")?.textContent).toBe("Publishing needs a verified profile."),
    );

    const input = own.querySelector<HTMLInputElement>("[data-action=upload-asset]")!;
    const file = new File(["<html>bad</html>"], "days.html", { type: "text/html" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(() =>
      expect(own.querySelector('[data-asset-problem="ref.invalid"]')?.textContent).toBe(
        '"Genesis 99:1" is not a ref Sefaria knows.',
      ),
    );
    expect(saveAsset).toHaveBeenCalledWith("<html>bad</html>");
    expect(own.querySelector("[data-asset-message]")!.getAttribute("role")).toBe("alert");
  });

  // @ac 063/AC-007
  it("shows an asset embed as a card with its title, author and Open, or that it is no longer available", async () => {
    expect(cardModules["../post/EmbedCard.tsx"], "EmbedCard exists").toBeDefined();
    const { EmbedCard } = await cardModules["../post/EmbedCard.tsx"]!();
    const box = await mount(
      createElement(EmbedCard, {
        embed: { kind: "asset", id: B, title: "The Seven Days", leader: "Chana", contentUrl: CONTENT },
      }),
    );
    const card = box.querySelector("[data-embed-card=asset]")!;
    const open = card.querySelector<HTMLAnchorElement>("[data-embed-action=asset]")!;
    expect([
      card.querySelector("[data-embed-title]")?.textContent,
      card.querySelector("[data-embed-leader]")?.textContent,
      open.getAttribute("href"),
      open.target,
      open.rel,
    ]).toEqual(["The Seven Days", "by Chana", CONTENT, "_blank", "noopener noreferrer"]);
    const gone = await mount(createElement(EmbedCard, { embed: { kind: "asset", id: B, title: null, leader: null } }));
    expect([gone.querySelector("[data-embed-card=asset]")?.textContent, gone.querySelector("a")]).toEqual([
      "Claude assetThis asset is no longer available.",
      null,
    ]);
  });
});
