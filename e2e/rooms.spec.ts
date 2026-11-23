// P3's exit journey (spec 014 AC-004; plan section 8): two learners in one room on the harness, with the real social server
// (Postgres), the relay under wrangler dev, and tokens verified against a local JWKS. When the leader moves, the follower's
// (fake) reader follows; a refresh of the follower's ctx address reconnects; Back leaves; the follower's own settings slice
// is never touched. Desktop only: two browser contexts, no layout under test.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const LEADER: Persona = { id: 4242, name: "Leader Learner" };
const FOLLOWER: Persona = { id: 5151, name: "Follower Learner" };
const FOLLOWER_SETTINGS = { v: 1, value: { fontSize: 30, language: "hebrew" } };

async function learner(browser: Browser, persona: Persona, settings: { v: number; value: unknown }) {
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
      slices: { "sefaria.settings": settings, "sefaria.scroll": { v: 1, value: { seg: 1 } } },
      sliceScopes: { "sefaria.settings": "personal" },
    },
  );
  return { context, page: await context.newPage(), token };
}

const location = (page: Page) => page.locator("[data-harness=location]");
/** The person moves in the (fake) reader, keeping the room's ctx like the reader's own navigation does. */
const move = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeHost: { localMove(p: string): void } }).__fakeHost.localMove(p), path);
const settingsOf = async (page: Page) =>
  JSON.parse((await page.locator("[data-harness=snapshot]").textContent()) ?? "{}").slices?.["sefaria.settings"];

test.describe("two learners in one room", () => {
  // @feature SESS-050 Two learners in one room on the harness
  // @ac 014/AC-004
  test("the follower's reader follows the leader; a refresh reconnects; Back leaves; the follower's settings stay", async ({
    browser,
  }) => {
    const leader = await learner(browser, LEADER, { v: 1, value: { fontSize: 12, language: "english" } });
    const follower = await learner(browser, FOLLOWER, FOLLOWER_SETTINGS);

    // The leader creates the room through the API (a signed-in session: the token is accepted).
    const created = await fetch(`${API}/api/v1/rooms`, {
      method: "POST",
      headers: { authorization: `Bearer ${leader.token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Bereshit together" }),
    });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { id: string };
    const ctx = `ctx=social.room.${room.id}`;

    // Leader: the lobby, the presence list, Enter. Nobody publishes yet, so the leader lands in the library and leads.
    await leader.page.goto(`/social/r/${room.id}`);
    await expect(leader.page.locator("h1")).toHaveText("Bereshit together");
    await expect(leader.page.locator("[data-social-presence] [data-self]")).toContainText("Leader Learner (you)");
    await leader.page.getByRole("button", { name: "Enter the room" }).click();
    await expect(location(leader.page)).toHaveText(`/texts?${ctx}`);
    await expect(leader.page.locator("[data-follow-line]")).toHaveText("You are leading");
    await move(leader.page, "/Genesis.2");
    await expect(location(leader.page)).toHaveText(`/Genesis.2?${ctx}`);

    // Follower: the link, Join, the presence list shows both, Enter lands on the leader's place.
    await follower.page.goto(`/social/r/${room.id}`);
    await follower.page.getByRole("button", { name: "Join" }).click();
    await expect(follower.page.locator("h1")).toHaveText("Bereshit together");
    await expect(follower.page.locator("[data-social-presence] li")).toHaveCount(2);
    await follower.page.getByRole("button", { name: "Enter the room" }).click();
    await expect(location(follower.page)).toHaveText(`/Genesis.2?${ctx}`);
    await expect(follower.page.locator("[data-follow-line]")).toHaveText("Following Leader Learner");

    // The leader moves; the follower's reader follows, by replacing (no new history entry), with its own settings intact.
    await move(leader.page, "/Genesis.5");
    await expect(location(follower.page)).toHaveText(`/Genesis.5?${ctx}`);
    expect(await settingsOf(follower.page)).toEqual(FOLLOWER_SETTINGS);
    expect(await follower.page.evaluate(() => history.length)).toBe(3); // harness start, lobby, the one enlarge

    // A refresh on the ctx address reconnects from the ctx alone and keeps following.
    await follower.page.reload();
    await expect(follower.page.locator("[data-follow-line]")).toHaveText("Following Leader Learner");
    await move(leader.page, "/Genesis.6");
    await expect(location(follower.page)).toHaveText(`/Genesis.6?${ctx}`);
    expect(await settingsOf(follower.page)).toEqual(FOLLOWER_SETTINGS);

    // Back leaves the room: the lobby, no ctx, and the leader's next move no longer reaches the follower.
    await follower.page.goBack();
    await expect(location(follower.page)).toHaveText(`/social/r/${room.id}`);
    await expect(follower.page.locator("[data-harness=ctx]")).toHaveText("(none)");
    await move(leader.page, "/Genesis.7");
    await expect(location(leader.page)).toHaveText(`/Genesis.7?${ctx}`);
    await expect(location(follower.page)).toHaveText(`/social/r/${room.id}`);

    await leader.context.close();
    await follower.context.close();
  });
});
