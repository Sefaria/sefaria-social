// L4a: the built surface in the harness (the fake reader page), through its manifest, as the reader loads it. Every journey
// runs in English and Hebrew; the Playwright projects run it on a desktop and a phone viewport.
import { expect, test, type Page } from "@playwright/test";

const LANGS = {
  english: {
    lang: "en",
    dir: "ltr",
    room: "Room",
    shiur: "Shiur",
    settings: "Settings",
    notFound: "Page not found",
    notifications: "Notifications",
    backToRoom: "Back to the room",
  },
  hebrew: {
    lang: "he",
    dir: "rtl",
    room: "חדר",
    shiur: "שיעור",
    settings: "הגדרות",
    notFound: "העמוד לא נמצא",
    notifications: "התראות",
    backToRoom: "חזרה לחדר",
  },
} as const;

const pageMount = (page: Page) => page.locator("[data-surface-mount=page]");
const heading = (page: Page) => pageMount(page).locator("main h1");
const location = (page: Page) => page.locator("[data-harness=location]");

for (const [interfaceLang, t] of Object.entries(LANGS) as [keyof typeof LANGS, (typeof LANGS)[keyof typeof LANGS]][]) {
  test.describe(`harness, ${interfaceLang} interface`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((lang) => {
        (window as unknown as { __HARNESS_CONFIG__: unknown }).__HARNESS_CONFIG__ = { interfaceLang: lang };
      }, interfaceLang);
    });

    // @feature HOST-005 Harness page loads the built surface into the fake host
    // @feature ROOM-001 Room lobby page at /social/r/$roomId
    // @feature SHIUR-001 Shiur page at /social/s/$shiurId
    // @feature HOST-006 Social settings page at /social/settings
    // @feature HOST-007 Social's own not-found page
    // @ac 002/AC-011
    test("every R6 page loads from a deep link, in the interface language", async ({ page }) => {
      const cases: [string, string][] = [
        ["/social", "Sefaria Social"],
        ["/social/r/room-00001", t.room],
        ["/social/s/shiur-0001", t.shiur],
        ["/social/settings?tab=notifications", t.settings],
        ["/social/r/bad", t.notFound],
        ["/social/anything/else", t.notFound],
      ];
      for (const [url, expected] of cases) {
        await page.goto(url);
        await expect(heading(page)).toHaveText(expected);
        await expect(location(page)).toHaveText(url);
        await expect(pageMount(page).locator("[data-social-root]")).toHaveAttribute("lang", t.lang);
        await expect(pageMount(page).locator("[data-social-root]")).toHaveAttribute("dir", t.dir);
      }
    });

    // @feature HOST-003 Surface entry mounts into the reader page
    // @ac 002/AC-011
    test("links push through the host; the browser's Back and Forward move through social pages", async ({ page }) => {
      await page.goto("/social/r/room-00001");
      await expect(heading(page)).toHaveText(t.room);
      await pageMount(page).getByRole("link", { name: t.settings, exact: true }).click();
      await expect(heading(page)).toHaveText(t.settings);
      await pageMount(page).getByRole("link", { name: t.notifications }).click();
      await expect(page).toHaveURL(/\/social\/settings\?tab=notifications$/);
      await expect(pageMount(page).locator("[data-settings-tab]")).toHaveAttribute("data-settings-tab", "notifications");
      await page.goBack();
      await expect(page).toHaveURL(/\/social\/settings$/);
      await page.goBack();
      await expect(heading(page)).toHaveText(t.room);
      await page.goForward();
      await expect(heading(page)).toHaveText(t.settings);
    });

    // @feature HOST-003 Surface entry mounts into the reader page
    // @ac 002/AC-011
    test("the persistent mount is empty on a reader page and offers the way back inside a social context", async ({ page }) => {
      await page.goto("/Genesis.1");
      await expect(page.locator("[data-harness=reader-page]")).toHaveText("Reader page: /Genesis.1");
      await expect(page.locator("body")).toHaveAttribute("data-surface-state", "loaded");
      await expect(page.locator("[data-surface-mount=persistent]")).toBeEmpty();
      await page.goto("/Genesis.1?ctx=social.room.room-00001");
      await expect(page.locator("[data-harness=ctx]")).toHaveText("social.room.room-00001");
      await page.getByRole("link", { name: t.backToRoom }).click();
      await expect(heading(page)).toHaveText(t.room);
      await expect(page).toHaveURL(/\/social\/r\/room-00001$/);
    });
  });
}
