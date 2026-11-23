// Visual checks of the feed and its cards (spec 016 AC-005; plan 4.7): English, Hebrew and dark, on the harness with the real
// server and relay. One live room (a publisher page), one recent room, one scheduled shiur in that room. Fixed time zone and
// locale so dates render the same everywhere; baselines are per platform (e2e/feed-visual.spec.ts-snapshots/).
import { expect, test } from "@playwright/test";
import pg from "pg";
import { STACK } from "./stack/config";
import { createRoom, feedOf, publish } from "./stack/publisher";
import { tokenFor, type Persona } from "./stack/tokens";

const VIEWER: Persona = { id: 7401, name: "Visual Viewer" };
const PUBLISHER: Persona = { id: 7402, name: "Visual Publisher" };

const variants = [
  { name: "english", interfaceLang: "english", theme: "light" },
  { name: "hebrew", interfaceLang: "hebrew", theme: "light" },
  { name: "dark", interfaceLang: "english", theme: "dark" },
] as const;

test.describe("feed visual checks", () => {
  // @feature FEED-016 Light card: article with one stretched link and status in words
  // @ac 016/AC-005
  test("the feed in English, Hebrew and dark matches its baselines", async ({ browser }) => {
    const token = await tokenFor(VIEWER);
    const live = await createRoom(token, "Bereshit together");
    const quiet = await createRoom(token, "Mishnah circle");
    const db = new pg.Client({ connectionString: STACK.databaseUrl });
    await db.connect();
    try {
      await db.query("update rooms set updated_at = '2026-11-20T10:00:00Z' where id = $1", [quiet.id]);
      await db.query(
        `insert into shiurim (room_id, teacher_user_id, title, ref, visibility, scheduled_at)
         values ($1, $2, 'Daf Yomi', 'Berakhot 2a', 'private', '2030-01-01T18:00:00Z')`,
        [quiet.id, VIEWER.id],
      );
    } finally {
      await db.end();
    }
    const publisher = await publish(browser, PUBLISHER, [
      { roomId: live.id, url: "/Genesis.1", summary: { ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis" } },
    ]);
    await expect.poll(async () => (await feedOf(token)).live.length, { timeout: 10_000 }).toBe(1);

    for (const v of variants) {
      const context = await browser.newContext({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1000, height: 900 } });
      await context.addInitScript((config) => Object.assign(window, { __HARNESS_CONFIG__: config }), {
        viewer: { id: VIEWER.id, name: VIEWER.name },
        token,
        apiOrigin: `http://127.0.0.1:${STACK.apiPort}`,
        relayOrigin: `ws://127.0.0.1:${STACK.relayPort}`,
        interfaceLang: v.interfaceLang,
        theme: v.theme,
      });
      const page = await context.newPage();
      await page.goto("/social");
      const feed = page.locator("[data-social-page=feed]");
      await expect(feed.locator("[data-source-text=ready]")).toHaveCount(2);
      await expect(feed).toHaveScreenshot(`feed-${v.name}.png`, { animations: "disabled", maxDiffPixelRatio: 0.01 });
      await context.close();
    }
    await publisher.close();
  });
});
