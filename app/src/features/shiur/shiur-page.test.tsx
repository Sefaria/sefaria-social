// @vitest-environment jsdom
// Spec 063 AC-007: a shiur page lists its recordings and its pinned Claude assets, each opening (its signed shiur URL) in a new
// tab; a private or unknown shiur keeps the placeholder and says so.
// @feature FEED-077 Claude assets as post cards and on profile and shiur pages
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { SocialApiContext, SocialApiError, type SocialApi } from "~/features/api/social-api";
import { HostContext } from "~/features/host/host-context";
import { ShiurPage } from "./ShiurPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const SHIUR = "11111111-2222-4333-8444-555555555555";
const REC = "22222222-2222-4333-8444-555555555555";
const ASSET = "33333333-2222-4333-8444-555555555555";

async function mount(el: ReactElement, api: Partial<SocialApi>) {
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

describe("spec 063: the shiur page", () => {
  // @ac 063/AC-007
  it("lists the shiur's recordings and pinned assets, and says when it is private or unknown", async () => {
    const shiur = vi.fn(async () => ({
      id: SHIUR,
      title: "Bereshit",
      visibility: "unlisted" as const,
      owner: { name: "Rav U", profileId: null },
      recordings: [{ id: REC, title: "Week 1", startedAt: "2026-11-27T00:00:00Z", durationMs: 1000 }],
      assets: [
        {
          assetId: ASSET,
          versionId: "v1",
          n: 1,
          title: "The Seven Days",
          description: "Creation, day by day.",
          refs: ["Genesis 1:1-5"],
          firstRef: "Genesis 1:1-5",
          position: 0,
          contentUrl: "https://assets.example.test/c/v1",
          shiurUrl: "https://assets.example.test/c/v1/shiur/grant",
        },
      ],
      createdAt: "2026-11-27T00:00:00Z",
      updatedAt: "2026-11-27T00:00:00Z",
    }));
    const box = await mount(createElement(ShiurPage, { shiurId: SHIUR }), { shiur });
    await vi.waitFor(() => expect(box.querySelector("h1")?.textContent).toBe("Bereshit"));
    expect(shiur).toHaveBeenCalledWith(SHIUR);
    const open = box.querySelector<HTMLAnchorElement>("[data-shiur-assets] [data-action=open-asset]")!;
    expect([
      box.querySelector(`[data-shiur-recording="${REC}"] a`)?.getAttribute("href"),
      box.querySelector(`[data-claude-asset="${ASSET}"]`)?.textContent?.includes("The Seven Days · version 1"),
      open.getAttribute("href"),
      open.target,
    ]).toEqual([`/social/rec/${REC}`, true, "https://assets.example.test/c/v1/shiur/grant", "_blank"]);

    const missing = await mount(createElement(ShiurPage, { shiurId: SHIUR }), {
      shiur: vi.fn(async () => {
        throw new SocialApiError(404, "shiur.not_found");
      }),
    });
    await vi.waitFor(() =>
      expect(missing.querySelector("[data-shiur-missing]")?.textContent).toBe("This shiur is private or does not exist."),
    );
  });
});
