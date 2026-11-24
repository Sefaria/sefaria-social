// Spec 040's call journey (AC-002 to AC-004): two learners in one room's call on the harness, with the real social server, the
// relay and LiveKit in development mode (e2e/stack/start.ts). Chromium plays fake cameras and microphones. Everything is read
// from the page: frames arriving in a <video>, audio playing in an <audio>, the muted mark, the panel's state. Runs on the
// desktop and phone projects; each project uses its own people, so the two runs never share a LiveKit identity.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
/**
 * Chromium on macOS cannot capture its fake microphone when launched from a sandboxed tool (getUserMedia for audio never
 * resolves; the camera works), so audio and mute are checked where audio capture works: Linux, which is what CI runs. On
 * macOS the journey joins with the microphone off, checks everything else, and says so in the report.
 */
const AUDIO = process.platform === "linux" || process.env.E2E_CALL_AUDIO === "1";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

async function learner(browser: Browser, persona: Persona, contextOptions: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext({ ...contextOptions, permissions: ["camera", "microphone"] });
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

const api = (token: string, method: string, p: string, body?: unknown) =>
  fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const move = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeHost: { localMove(p: string): void } }).__fakeHost.localMove(p), path);

/** Join the room's call from its lobby with the camera on, and the microphone where audio is checked. */
async function joinCall(page: Page, roomId: string) {
  await page.goto(`/social/r/${roomId}`);
  await page.locator('[data-social-page="room"] [data-action="join-call"]').click();
  if (AUDIO) await page.locator('[data-action="toggle-mic"]').click();
  await page.locator('[data-action="toggle-camera"]').click();
  await expect(page.locator("video[data-preview]")).toBeVisible();
  await page.locator('[data-action="join-now"]').click();
  // On a phone the call docks as a strip that starts collapsed, receiving no video (spec 037): expand it to see the tiles.
  const strip = page.locator('[data-call-strip][data-expanded="false"]');
  await expect(page.locator('[data-social-call="in-call"]').or(strip).first()).toBeVisible({ timeout: 15_000 });
  if (await strip.isVisible()) await strip.locator('[data-action="expand-call"]').click();
  await expect(page.locator('section[data-social-call="in-call"]')).toBeVisible();
}

/** Frames from that participant's camera have arrived in this page. */
const videoArrived = (page: Page, identity: string) =>
  expect
    .poll(
      () =>
        page
          .locator(`[data-participant="${identity}"] video`)
          .evaluate((v: HTMLVideoElement) => v.videoWidth)
          .catch(() => 0),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

/** Some remote audio is playing in this page. */
const audioPlaying = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll("audio")].some((a) => !a.paused && a.srcObject !== null && a.currentTime > 0),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

test.describe("a room's call", () => {
  // @feature OPS-095 Two-browser call journey on a local LiveKit
  // @ac 040/AC-002
  // @ac 040/AC-003
  // @ac 040/AC-004
  test("two learners see and hear each other; mute shows; the call survives moving; leaving keeps the room", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const base = testInfo.project.name === "phone" ? 7700 : 7600;
    const A: Persona = { id: base + 1, name: "Call Learner A" };
    const B: Persona = { id: base + 2, name: "Call Learner B" };
    const options = testInfo.project.use;
    const a = await learner(browser, A, {
      viewport: options.viewport,
      userAgent: options.userAgent,
      isMobile: options.isMobile,
      hasTouch: options.hasTouch,
    });
    const b = await learner(browser, B, {
      viewport: options.viewport,
      userAgent: options.userAgent,
      isMobile: options.isMobile,
      hasTouch: options.hasTouch,
    });

    const created = await api(a.token, "POST", "/api/v1/rooms", { title: `Call ${testInfo.project.name}` });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { id: string; calls: { available: boolean } };
    expect(room.calls).toEqual({ available: true });
    expect((await api(b.token, "POST", `/api/v1/rooms/${room.id}/members`)).status).toBe(200);

    await joinCall(a.page, room.id);
    await joinCall(b.page, room.id);

    // Each sees and hears the other.
    await videoArrived(b.page, `u:${A.id}`);
    await videoArrived(a.page, `u:${B.id}`);
    if (AUDIO) {
      await audioPlaying(b.page);
      await audioPlaying(a.page);

      // A mutes: B sees A muted.
      await expect(b.page.locator(`[data-participant="u:${A.id}"]`)).not.toContainText("muted");
      await a.page.locator('[data-action="mic"]').click();
      await expect(b.page.locator(`[data-participant="u:${A.id}"]`)).toContainText("muted");
    } else {
      testInfo.annotations.push({
        type: "not checked",
        description: "audio and mute: this platform's Chromium cannot capture its fake microphone here (they run on Linux/CI)",
      });
      await expect(b.page.locator(`[data-participant="u:${A.id}"]`)).toContainText("muted"); // joined with it off
    }

    // A reads elsewhere: still in the same call, no new join (B still sees A's video, the panel never left in-call).
    await move(a.page, "/Genesis.2");
    await expect(a.page.locator("[data-harness=location]")).toHaveText("/Genesis.2");
    await expect(a.page.locator('[data-social-call="in-call"]')).toBeVisible();
    await expect(a.page.locator(`[data-participant="u:${B.id}"]`)).toBeVisible();
    await videoArrived(b.page, `u:${A.id}`);

    // A leaves the call: gone from B's call, still a member of the room.
    await a.page.locator('[data-action="leave-call"]').click();
    await expect(a.page.locator("[data-social-call]")).toHaveCount(0);
    await expect(b.page.locator(`[data-participant="u:${A.id}"]`)).toHaveCount(0, { timeout: 15_000 });
    const stillMember = await api(a.token, "GET", `/api/v1/rooms/${room.id}`);
    expect(stillMember.status).toBe(200);

    await a.context.close();
    await b.context.close();
  });
});
