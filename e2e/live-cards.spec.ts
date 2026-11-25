// Spec 056 AC-005, on the harness with the real server, Postgres and the relay: a room's owner leads it from Genesis 1; a post
// embeds the room; the card in another person's timeline shows Genesis 1, and within 20 seconds of the leader's move to
// Genesis 2 it shows Genesis 2 (the relay reports at most every 5 seconds, the card asks every 15). The card opens no socket.
// Desktop only: several browser contexts.
import { expect, test } from "@playwright/test";
import { STACK } from "./stack/config";
import { createRoom, move, postWithEmbed, publish, type LiveRoom } from "./stack/publisher";
import { tokenFor, type Persona } from "./stack/tokens";

const VIEWER: Persona = { id: 7601, name: "Card Viewer" };
const LEADER: Persona = { id: 7602, name: "Card Leader" };

test.describe("live cards in posts", () => {
  // @feature FEED-076 Live cards in posts: the leader's current text, polled only while seen
  // @ac 056/AC-005
  test("a posted room's card follows its leader to the next text within 20 seconds", async ({ browser }) => {
    test.setTimeout(90_000); // two polls of 15 seconds and the relay's 5-second window
    const leaderToken = await tokenFor(LEADER);
    const viewerToken = await tokenFor(VIEWER);
    const room = await createRoom(leaderToken, "Bereshit with the leader");
    const at = (n: number): LiveRoom => ({
      roomId: room.id,
      url: `/Genesis.${n}`,
      summary: { ref: `Genesis ${n}`, heRef: null, title: "Genesis" },
    });
    const publisher = await publish(browser, LEADER, [at(1)]);
    expect(await postWithEmbed(viewerToken, "Come learn with us", { kind: "room", id: room.id })).toBe(201);

    const context = await browser.newContext();
    await context.addInitScript((config) => Object.assign(window, { __HARNESS_CONFIG__: config }), {
      viewer: { id: VIEWER.id, name: VIEWER.name },
      token: viewerToken,
      apiOrigin: `http://127.0.0.1:${STACK.apiPort}`,
      relayOrigin: `ws://127.0.0.1:${STACK.relayPort}`,
    });
    const page = await context.newPage();
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    const liveReads: string[] = [];
    page.on("request", (r) => r.url().includes("/api/v1/live?") && liveReads.push(r.url()));
    await page.goto("/social");

    const card = page.locator(`[data-embed-card=room][data-embed-id="${room.id}"]`);
    await expect(card.locator("[data-embed-title]")).toHaveText("Bereshit with the leader");
    await expect(card.locator("[data-embed-leader]")).toHaveText("with Card Leader");
    expect(liveReads, "the card is below the harness's reader pane: off screen, it asks nothing").toEqual([]);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("[data-embed-status]")).toHaveAttribute("data-embed-status", "live", { timeout: 20_000 });
    await expect(card.locator("[data-embed-ref]")).toHaveText("Genesis 1", { timeout: 20_000 });
    await expect(card.locator("[data-source-text=ready]")).toHaveCount(1);
    await card.scrollIntoViewIfNeeded(); // the text made the card taller; keep it in view, as a reader would

    await move(publisher, 0, at(2), 1);
    const moved = Date.now();
    await expect(card.locator("[data-embed-ref]")).toHaveText("Genesis 2", { timeout: 20_000 });
    expect(Date.now() - moved).toBeLessThan(20_000);
    expect(sockets).toEqual([]);
    expect(new Set(liveReads.map((u) => new URL(u).searchParams.get("ids")))).toEqual(new Set([room.id]));

    await context.close();
    await publisher.close();
  });
});
