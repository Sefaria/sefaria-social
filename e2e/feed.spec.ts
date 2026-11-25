// P4's exit journey (plan section 8; specs 016 AC-003 and 018 AC-001), on the harness with the real server, Postgres and the
// relay: a feed of live cards opens no WebSocket; pressing a card enlarges into its room, landing the (fake) reader on the
// card's source inside the same document (no reload); Back returns to the feed. Desktop only: several browser contexts.
import { expect, test, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { createRoom, feedOf, joinRoom, publish, type LiveRoom } from "./stack/publisher";
import { tokenFor, type Persona } from "./stack/tokens";

const VIEWER: Persona = { id: 7301, name: "Feed Viewer" };
const PUBLISHER: Persona = { id: 7302, name: "Feed Publisher" };

/** The ref a reader address shows, the way the publisher's summary derives it ("/Exodus.3" → "Exodus 3"). */
const refOf = (url: string) => decodeURIComponent(url.split(/[?#]/)[0]!.split("/").filter(Boolean)[0]!).replace(/[._]/g, " ");
const location = (page: Page) => page.locator("[data-harness=location]");

test.describe("the feed", () => {
  // @feature FEED-052 A feed of live cards opens no sockets
  // @ac 016/AC-003
  // @feature SESS-055 Enlarging from a card lands on its source without a reload
  // @ac 018/AC-001
  test("a feed of three live cards opens no socket; pressing one lands on its source without a reload; Back returns", async ({
    browser,
  }) => {
    const token = await tokenFor(VIEWER);
    const titles = ["Bereshit together", "Shemot study", "Tehillim"];
    // The publisher owns the rooms (only the owner leads, spec 048); the viewer is a member of each.
    const publisherToken = await tokenFor(PUBLISHER);
    const rooms = await Promise.all(titles.map((t) => createRoom(publisherToken, t)));
    await Promise.all(rooms.map((r) => joinRoom(token, r.id)));
    const live: LiveRoom[] = [
      { roomId: rooms[0]!.id, url: "/Genesis.1", summary: { ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis" } },
      { roomId: rooms[1]!.id, url: "/Exodus.3", summary: { ref: "Exodus 3", heRef: "שמות ג׳", title: "Exodus" } },
      { roomId: rooms[2]!.id, url: "/Psalms.23", summary: { ref: "Psalms 23", heRef: "תהילים כ״ג", title: "Psalms" } },
    ];
    const publisher = await publish(browser, PUBLISHER, live);
    await expect.poll(async () => (await feedOf(token)).live.length, { timeout: 10_000 }).toBe(3);

    const context = await browser.newContext();
    await context.addInitScript((config) => Object.assign(window, { __HARNESS_CONFIG__: config }), {
      viewer: { id: VIEWER.id, name: VIEWER.name },
      token,
      apiOrigin: `http://127.0.0.1:${STACK.apiPort}`,
      relayOrigin: `ws://127.0.0.1:${STACK.relayPort}`,
    });
    const page = await context.newPage();
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    let loads = 0;
    page.on("load", () => loads++);

    await page.goto("/social");
    await expect(page.locator("[data-feed-section=live] [data-feed-card=live]")).toHaveCount(3);
    await expect(page.locator("[data-feed-section=live] [data-source-text=ready]")).toHaveCount(3);
    await expect(page.locator("[data-feed-section=live] [data-card-status]").first()).toHaveText("Live · 1 person learning");
    expect(sockets).toEqual([]); // three live cards, their status and their text: no socket

    // Press the second card. The document must survive: a marker in memory, and no further page load.
    const loadsBefore = loads;
    await page.evaluate(() => Object.assign(window, { __sameDocument: "yes" }));
    const card = page.locator(`[data-feed-card][data-id="${live[1]!.roomId}"]`);
    const cardRef = await card.getAttribute("data-ref");
    await card.locator("a").click();
    await expect(location(page)).toHaveText(`/Exodus.3?ctx=social.room.${live[1]!.roomId}`);
    const applied = await page.evaluate(
      () =>
        (
          window as unknown as { __fakeHost: { calls: { applied: { snapshot: { url: string } }[] } } }
        ).__fakeHost.calls.applied.at(-1)?.snapshot.url ?? "",
    );
    expect(refOf(applied)).toBe(cardRef);
    expect(cardRef).toBe("Exodus 3");
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: string }).__sameDocument)).toBe("yes");
    expect(loads).toBe(loadsBefore);
    expect(sockets).toEqual([`ws://127.0.0.1:${STACK.relayPort}/r/${live[1]!.roomId}`]); // one, for the room entered

    await page.goBack();
    await expect(location(page)).toHaveText("/social");
    await expect(page.locator("[data-feed-section=live] [data-feed-card=live]")).toHaveCount(3);

    await context.close();
    await publisher.close();
  });
});
