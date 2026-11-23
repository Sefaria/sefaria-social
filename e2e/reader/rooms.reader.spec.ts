// L4b version of P3's exit journey (spec 014 AC-004): two learners in one room in the real reader. Disabled: not in the root
// Playwright config; run with e2e/reader/playwright.config.ts once the reader seam (A1) is merged (README.md here).
import { expect, test, type Page } from "@playwright/test";

const ROOM = process.env.E2E_ROOM_ID ?? "";
const ctxOf = (url: string) => new URL(url).searchParams.get("ctx");

/** The reader's own next-chapter control keeps ctx (the reader keeps it through workspace changes). */
async function nextChapter(page: Page) {
  await page.getByRole("link", { name: /next/i }).first().click();
}

test.describe("two learners in one room, in the reader", () => {
  test("the follower follows; a refresh reconnects; Back leaves", async ({ browser }) => {
    const leader = await (await browser.newContext({ storageState: process.env.E2E_LEADER_STATE })).newPage();
    const follower = await (await browser.newContext({ storageState: process.env.E2E_FOLLOWER_STATE })).newPage();
    await leader.goto(`/social/r/${ROOM}`);
    await leader.getByRole("button", { name: "Enter the room" }).click();
    await expect.poll(() => ctxOf(leader.url())).toBe(`social.room.${ROOM}`);
    await follower.goto(`/social/r/${ROOM}`);
    await follower.getByRole("button", { name: "Enter the room" }).click();
    await expect.poll(() => new URL(follower.url()).pathname).toBe(new URL(leader.url()).pathname);

    await nextChapter(leader);
    await expect.poll(() => new URL(follower.url()).pathname).toBe(new URL(leader.url()).pathname);

    await follower.reload();
    await nextChapter(leader);
    await expect.poll(() => new URL(follower.url()).pathname).toBe(new URL(leader.url()).pathname);

    await follower.goBack();
    await expect.poll(() => ctxOf(follower.url())).toBeNull();
  });
});
