// Spec 044's journey: someone starts a room from Social, invites a second person with the lobby's link, renames the room, the
// second person finds it on their rooms page and leaves it, and the owner deletes it. Runs on the harness with the real social
// server; everything is done from the interface.
import { expect, test, type Browser } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const OWNER: Persona = { id: 7301, name: "Room Starter" };
const GUEST: Persona = { id: 7302, name: "Room Guest" };

async function person(browser: Browser, persona: Persona) {
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
  return { context, page: await context.newPage() };
}

test.describe("starting, sharing and managing a room", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name !== "desktop" || browserName !== "chromium", "one browser is enough for the journey");
  });

  // @feature ROOM-046 Start a room from Social and land in its lobby
  // @feature ROOM-047 Your rooms at /social/rooms and Rooms in Social's navigation
  // @feature ROOM-048 Invite people from a room's lobby: its link with Copy and Share
  // @feature ROOM-049 Rename or delete a room you own
  // @feature ROOM-050 Leave a room you joined
  test("start a room, invite someone with its link, rename it, they leave, the owner deletes it", async ({ browser }) => {
    test.setTimeout(90_000);
    const owner = await person(browser, OWNER);
    const guest = await person(browser, GUEST);

    // Start a room from the home rail (AC-001, AC-007).
    await owner.page.goto("/social");
    await owner.page.locator("[data-rooms-bar] [data-action=start-room]").click();
    await expect(owner.page.locator("[data-action=confirm-start-room]")).toBeDisabled();
    await owner.page.locator("[data-room-name]").fill("Daf Yomi chavruta");
    await owner.page.locator("[data-action=confirm-start-room]").click();
    await expect(owner.page.locator('[data-social-page="room"] h1')).toHaveText("Daf Yomi chavruta", { timeout: 15_000 });
    await expect(owner.page.locator("[data-room-role]")).toHaveText("You own this room");

    // The invitation (AC-003).
    const link = await owner.page.locator("[data-room-link]").inputValue();
    const lobbyPath = new URL(link).pathname;
    expect(lobbyPath).toMatch(/^\/social\/r\/[0-9a-f-]{36}$/);

    // The guest opens the link and joins.
    await guest.page.goto(lobbyPath);
    await guest.page.locator("[data-action=join]").click();
    await expect(guest.page.locator("[data-room-role]")).toHaveText("You are a member of this room");

    // The owner renames it (AC-004); the guest sees the new name.
    await owner.page.locator("[data-action=rename-room]").click();
    await owner.page.locator("[data-rename-input]").fill("Mishnah Berurah");
    await owner.page.locator("[data-action=save-rename]").click();
    await expect(owner.page.locator('[data-social-page="room"] h1')).toHaveText("Mishnah Berurah");

    // The guest finds it on their rooms page through the nav (AC-002).
    await guest.page.goto("/social");
    await guest.page.locator("[data-nav=rooms]").click();
    const row = guest.page.locator("[data-room-row]");
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row.locator("a")).toHaveText("Mishnah Berurah");
    await expect(row.locator("[data-room-role]")).toHaveText("Member");

    // The guest leaves (AC-006).
    await row.locator("a").click();
    await guest.page.locator("[data-action=leave-room]").click();
    await guest.page.locator("[data-action=confirm-leave-room]").click();
    await expect(guest.page.locator("[data-rooms-notice]")).toHaveText("You left “Mishnah Berurah”.", { timeout: 15_000 });
    await expect(guest.page.locator("[data-rooms-empty]")).toBeVisible();

    // The owner deletes it (AC-005); its link no longer opens a room.
    await owner.page.locator("[data-action=delete-room]").click();
    await owner.page.locator("[data-action=confirm-delete-room]").click();
    await expect(owner.page.locator("[data-rooms-notice]")).toHaveText("“Mishnah Berurah” was deleted.", { timeout: 15_000 });
    await guest.page.goto(lobbyPath);
    await guest.page.locator("[data-action=join]").click();
    await expect(guest.page.locator('[data-social-page="room"] [role=alert]')).toBeVisible();

    await owner.context.close();
    await guest.context.close();
  });
});
