// Spec 035's call window in a real browser (AC-001, AC-004, AC-005): the harness page stands in for the reader, one learner
// joins a room's call (camera off, no microphone: nothing here needs media), and the window is opened, dragged and resized
// with the mouse. Layout is measured with getBoundingClientRect, which jsdom cannot do. Desktop only.
import { expect, test, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const LEARNER = { id: 7801, name: "Window Learner" };

test.skip(({ isMobile }) => !!isMobile, "the floating window is the desktop layout; phones dock the call (spec 037)");
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

type Box = { left: number; top: number; width: number; height: number };
/** The element's box once it has stopped moving (the window animates its moves for 150ms). */
const settled = async (page: Page, sel: string): Promise<Box> => {
  let last = await box(page, sel);
  await expect
    .poll(
      async () => {
        const now = await box(page, sel);
        const same = JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { intervals: [100, 100, 200, 200, 400] },
    )
    .toBe(true);
  return last;
};
const box = (page: Page, sel: string): Promise<Box> =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });

async function inCall(page: Page) {
  const token = await tokenFor(LEARNER);
  await page.addInitScript(
    (config) => {
      (window as unknown as { __HARNESS_CONFIG__: unknown }).__HARNESS_CONFIG__ = config;
    },
    { viewer: LEARNER, token, apiOrigin: API, relayOrigin: `ws://127.0.0.1:${STACK.relayPort}` },
  );
  const created = await fetch(`${API}/api/v1/rooms`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Window" }),
  });
  const room = (await created.json()) as { id: string };
  await page.goto(`/social/r/${room.id}`);
  await page.evaluate(() => localStorage.removeItem("sefaria-social.call-window"));
  return room.id;
}

/** Join without Playwright scrolling the page to the buttons (a real click on a visible button does not scroll either). */
async function join(page: Page) {
  await page.locator('[data-social-page="room"] [data-action="join-call"]').dispatchEvent("click");
  await page.locator('[data-action="join-now"]').dispatchEvent("click");
  await expect(page.locator('[data-social-call="in-call"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("the call window over the page", () => {
  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-001
  test("opening, moving, resizing and closing the window never moves the text column or its scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await inCall(page);
    // the lobby is rendered (it would otherwise reset the scroll as it mounts)
    await expect(page.locator('[data-social-page="room"] [data-action="join-call"]')).toBeVisible();
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "2000px";
      document.querySelector(".harness-reader")?.append(filler);
      window.scrollTo(0, 300);
    });
    const reader = '[aria-label="Reader pane"]';
    const before = { box: await box(page, reader), scroll: await page.evaluate(() => window.scrollY) };
    expect(before.scroll).toBe(300);

    await join(page);
    const win = await settled(page, "[data-call-window]");
    expect(await page.locator("[data-call-window]").evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    await page.mouse.move(win.left + 40, win.top + 12);
    await page.mouse.down();
    await page.mouse.move(200, 400, { steps: 8 });
    await page.mouse.up();
    const resize = await box(page, '[data-action="call-window-resize"]');
    await page.mouse.move(resize.left + 8, resize.top + 8);
    await page.mouse.down();
    await page.mouse.move(resize.left + 200, resize.top + 8, { steps: 8 });
    await page.mouse.up();
    await page.locator('[data-action="leave-call"]').click();
    await expect(page.locator("[data-call-window]")).toHaveCount(0);

    expect({ box: await box(page, reader), scroll: await page.evaluate(() => window.scrollY) }).toEqual(before);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-004
  test("dragging by the handle snaps to the nearest corner; dragging a tile moves nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await inCall(page);
    await join(page);
    const start = await settled(page, "[data-call-window]");
    expect(start.left + start.width).toBe(1280 - 16); // top right by default

    // from a tile: nothing moves
    const tile = await box(page, "[data-call-window] [data-participant]");
    await page.mouse.move(tile.left + 10, tile.top + 10);
    await page.mouse.down();
    await page.mouse.move(300, 700, { steps: 8 });
    await page.mouse.up();
    expect(await box(page, "[data-call-window]")).toEqual(start);

    // by the handle, dropped with the window's centre just left of the viewport's and low down: bottom left, 16px in
    const handle = await box(page, '[data-action="call-window-handle"]');
    const grabX = handle.left + 20;
    const dropX = grabX + (600 - (start.left + start.width / 2)); // window centre at x = 600
    await page.mouse.move(grabX, handle.top + 10);
    await page.mouse.down();
    await page.mouse.move(dropX, 700, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator("[data-call-window]")).toHaveAttribute("data-corner", "bottom-start");
    const end = await settled(page, "[data-call-window]");
    expect(end.left).toBe(16);
    expect(end.top + end.height).toBe(900 - 16);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-005
  test("resizing from the corner stops at the large size and keeps the tile area at 16:10", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await inCall(page);
    await join(page);
    const small = await settled(page, "[data-call-window]");
    // anchored top right: the resize handle is bottom left, and dragging left grows the window
    const handle = await box(page, '[data-action="call-window-resize"]');
    await page.mouse.move(handle.left + 8, handle.top + 8);
    await page.mouse.down();
    await page.mouse.move(handle.left - 1200, handle.top + 8, { steps: 12 });
    await page.mouse.up();
    const large = await settled(page, "[data-call-window]");
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.width).toBeLessThanOrEqual(0.6 * 1280);
    expect(large.height).toBeLessThanOrEqual(0.6 * 900);
    expect((large.height - 48) / large.width).toBeCloseTo(10 / 16, 1);
    // and not smaller than small
    const h2 = await box(page, '[data-action="call-window-resize"]');
    await page.mouse.move(h2.left + 8, h2.top + 8);
    await page.mouse.down();
    await page.mouse.move(h2.left + 1200, h2.top + 8, { steps: 12 });
    await page.mouse.up();
    expect((await settled(page, "[data-call-window]")).width).toBe(small.width);
  });
});
