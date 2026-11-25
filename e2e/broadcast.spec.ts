// Spec 043's journey: a room's owner broadcasts, and someone who is not in the room watches with the link. The viewer's reader
// follows the host's, the viewer can read around and come back, and the end of the broadcast reaches the viewer. Runs on the
// harness with the real social server and the relay (whose broadcast rooms require the server's signed ticket).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const HOST: Persona = { id: 7201, name: "Broadcast Host" };
const VIEWER: Persona = { id: 7202, name: "Broadcast Viewer" };

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
  return { context, page: await context.newPage(), token };
}

const location = (page: Page) => page.locator("[data-harness=location]");
const move = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeHost: { localMove(p: string): void } }).__fakeHost.localMove(p), path);

test.describe("broadcasting a session", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name !== "desktop" || browserName !== "chromium", "one browser is enough for the journey");
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  test("the owner broadcasts from the lobby; a viewer with the link follows the host, reads around, comes back, and sees the end", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const host = await person(browser, HOST);
    const viewer = await person(browser, VIEWER);

    const created = await fetch(`${API}/api/v1/rooms`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Daf shiur" }),
    });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { id: string };

    // The host starts the broadcast in the lobby and gets the link (AC-006).
    await host.page.goto(`/social/r/${room.id}`);
    await host.page.locator('[data-action="broadcast"]').click();
    const link = host.page.locator("[data-broadcast-link]");
    await expect(link).toHaveValue(/\/social\/b\//, { timeout: 15_000 });
    const href = (await link.inputValue()).trim();
    const broadcastPath = new URL(href, "http://x").pathname;
    const broadcastId = broadcastPath.split("/").pop()!;

    // The host goes to the reader and reads Genesis 1.
    await host.page.getByRole("button", { name: "Enter the room" }).click();
    await move(host.page, "/Genesis.1");
    await expect(location(host.page)).toHaveText(/^\/Genesis\.1/);

    // The viewer opens the link, presses Watch and lands on the host's text with the watch context (AC-007).
    await viewer.page.goto(broadcastPath);
    await expect(viewer.page.locator("[data-broadcast-host]")).toContainText("Broadcast Host");
    await viewer.page.locator('[data-action="watch"]').click();
    const watchCtx = `ctx=social.watch.${broadcastId}`;
    await expect(location(viewer.page)).toHaveText(`/Genesis.1?${watchCtx}`, { timeout: 20_000 });

    // The viewer's reader follows the host.
    await move(host.page, "/Genesis.3");
    await expect(location(viewer.page)).toHaveText(`/Genesis.3?${watchCtx}`, { timeout: 15_000 });

    // Reading around stops following; Back to live returns to the host's place.
    await move(viewer.page, "/Exodus.1");
    await expect(viewer.page.locator('[data-action="back-to-live"]')).toBeVisible();
    await move(host.page, "/Genesis.4");
    await expect(location(viewer.page)).toHaveText(`/Exodus.1?${watchCtx}`);
    await viewer.page.locator('[data-action="back-to-live"]').click();
    await expect(location(viewer.page)).toHaveText(`/Genesis.4?${watchCtx}`, { timeout: 15_000 });

    // The host's reader is never moved by the viewer.
    await expect(location(host.page)).toHaveText(/^\/Genesis\.4/);

    // The host ends it; the viewer is told (AC-008).
    await host.page.goto(`/social/r/${room.id}`);
    await host.page.locator('[data-action="end-broadcast"]').click();
    await expect(viewer.page.locator("[data-broadcast-ended]").first()).toBeVisible({ timeout: 20_000 });

    await host.context.close();
    await viewer.context.close();
  });
});
