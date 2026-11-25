// Spec 045's journey: two learners in a room on the harness. The leader follows a plain reader link (the harness's "Genesis 1"
// link navigates without ctx, as the reader's links do) and stays in the room, still leading, with the follower following; the
// follower reads around, follows a link, stays in the room on their own and follows again. The room window is a labelled card.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const LEADER: Persona = { id: 7501, name: "Window Leader" };
const FOLLOWER: Persona = { id: 7502, name: "Window Follower" };

async function learner(browser: Browser, persona: Persona) {
  const context = await browser.newContext();
  const token = await tokenFor(persona);
  await context.addInitScript(
    (config) => {
      (window as unknown as { __HARNESS_CONFIG__: unknown }).__HARNESS_CONFIG__ = config;
    },
    {
      viewer: { id: persona.id, name: persona.name },
      token,
      apiOrigin: API,
      relayOrigin: `ws://127.0.0.1:${STACK.relayPort}`,
      slices: { "sefaria.scroll": { v: 1, value: { seg: 1 } } },
    },
  );
  return { context, page: await context.newPage(), token };
}

const location = (page: Page) => page.locator("[data-harness=location]");
const move = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeHost: { localMove(p: string): void } }).__fakeHost.localMove(p), path);
const readerLink = (page: Page) => page.locator("a[data-harness-link][href='/Genesis.1']").click();

test.describe("the room stays with you", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name !== "desktop" || browserName !== "chromium", "one browser is enough for the journey");
  });

  // @feature SESS-067 Stay in the room while reading around the reader
  // @feature SESS-068 The room window in the reader: a card with the room, its status and who is here
  test("following a reader link keeps the leader and the follower in the room, in its window", async ({ browser }) => {
    test.setTimeout(90_000);
    const leader = await learner(browser, LEADER);
    const follower = await learner(browser, FOLLOWER);
    const created = await fetch(`${API}/api/v1/rooms`, {
      method: "POST",
      headers: { authorization: `Bearer ${leader.token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Chumash chavruta" }),
    });
    const room = (await created.json()) as { id: string };
    const ctx = `ctx=social.room.${room.id}`;
    await fetch(`${API}/api/v1/rooms/${room.id}/members`, { method: "POST", headers: { authorization: `Bearer ${follower.token}` } });

    await leader.page.goto(`/social/r/${room.id}`);
    await leader.page.getByRole("button", { name: "Enter the room" }).click();
    await expect(leader.page.locator("[data-follow-line]")).toHaveText("You are leading", { timeout: 15_000 });
    await move(leader.page, "/Genesis.3");

    await follower.page.goto(`/social/r/${room.id}`);
    await follower.page.getByRole("button", { name: "Enter the room" }).click();
    await expect(location(follower.page)).toHaveText(`/Genesis.3?${ctx}`, { timeout: 15_000 });

    // The room window: a labelled card with the room's title (AC-003).
    const card = leader.page.getByRole("region", { name: "Room: Chumash chavruta" });
    await expect(card).toBeVisible();
    await expect(card.locator("[data-follow-line]")).toHaveText("You are leading");

    // The leader follows a plain reader link: still in the room, still leading; the follower follows (AC-001).
    await readerLink(leader.page);
    await expect(location(leader.page)).toHaveText(`/Genesis.1?${ctx}`);
    await expect(card.locator("[data-follow-line]")).toHaveText("You are leading");
    await expect(location(follower.page)).toHaveText(`/Genesis.1?${ctx}`, { timeout: 15_000 });

    // The follower reads around and follows a link: still in the room, on their own; Follow again (AC-002).
    await move(follower.page, "/Exodus.1");
    await readerLink(follower.page);
    await expect(location(follower.page)).toHaveText(`/Genesis.1?${ctx}`);
    await expect(follower.page.locator("[data-follow-line]")).toHaveText("You are on your own");
    await move(leader.page, "/Genesis.5");
    await follower.page.locator("[data-action=follow-again]").click();
    await expect(location(follower.page)).toHaveText(`/Genesis.5?${ctx}`, { timeout: 15_000 });

    // Back to the lobby still leaves (spec 013).
    await leader.page.goto(`/social/r/${room.id}`);
    await expect(leader.page.locator("[data-room-window]")).toHaveCount(0);

    await leader.context.close();
    await follower.context.close();
  });
});
