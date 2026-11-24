// Specs 041 and 042's journey: a room's owner records a session with its call, and a member plays it back in the reader. Runs on
// the harness with the real social server, the relay and LiveKit in development mode (e2e/stack/start.ts); Chromium records its
// fake camera through the recorder's canvas and MediaRecorder, so the media track is real WebM. Everything is checked from the
// page and the API: the badge, the stored chunks and state, the reader following the recording, the video playing.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const OWNER: Persona = { id: 7101, name: "Recording Owner" };
const MEMBER: Persona = { id: 7102, name: "Recording Member" };

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
});

async function learner(browser: Browser, persona: Persona) {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
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

const location = (page: Page) => page.locator("[data-harness=location]");
const move = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __fakeHost: { localMove(p: string): void } }).__fakeHost.localMove(p), path);

test.describe("recording a room's session and playing it back", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name !== "desktop" || browserName !== "chromium", "one browser records; the phone strip is covered by unit tests");
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  test("the owner records the call and the reader; a member plays it back and the reader follows the recording", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await learner(browser, OWNER);
    const member = await learner(browser, MEMBER);

    const created = await api(owner.token, "POST", "/api/v1/rooms", { title: "Recorded chavruta" });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { id: string };
    expect((await api(member.token, "POST", `/api/v1/rooms/${room.id}/members`)).status).toBeLessThan(300);

    // The owner enters the room (leading the reader), then joins the call with the camera on.
    await owner.page.goto(`/social/r/${room.id}`);
    await owner.page.getByRole("button", { name: "Enter the room" }).click();
    await expect(location(owner.page)).toHaveText(new RegExp(`ctx=social\\.room\\.${room.id}`));
    await move(owner.page, "/Genesis.1");
    await owner.page.goto(`/social/r/${room.id}`);
    await owner.page.locator('[data-social-page="room"] [data-action="join-call"]').click();
    await owner.page.locator('[data-action="toggle-camera"]').click();
    await owner.page.locator('[data-action="join-now"]').click();
    await expect(owner.page.locator('section[data-social-call="in-call"]')).toBeVisible({ timeout: 20_000 });

    // Record: everyone in the room is told (AC-006), the reader moves, then Stop.
    await owner.page.locator('[data-social-page="room"] [data-action="record"]').click();
    await expect(owner.page.locator("[data-recording-badge]").first()).toBeVisible({ timeout: 15_000 });
    const running = (await (await api(member.token, "GET", `/api/v1/rooms/${room.id}`)).json()) as { recording?: boolean };
    expect(running.recording, "the room says it is being recorded").toBe(true);
    await owner.page.waitForTimeout(3_000);
    await move(owner.page, "/Genesis.2");
    await owner.page.waitForTimeout(4_000);
    await owner.page.locator('[data-action="stop-recording"]').first().click();
    await expect(owner.page.locator('[data-action="record"]').first()).toBeVisible({ timeout: 30_000 });

    // The server holds a ready recording: media chunks and a state track from keyframe to keyframe (AC-007).
    const list = (await (await api(member.token, "GET", `/api/v1/rooms/${room.id}/recordings`)).json()) as {
      recordings: { id: string; status: string; durationMs: number | null }[];
    };
    expect(list.recordings).toHaveLength(1);
    const rec = list.recordings[0]!;
    expect(rec.status).toBe("ready");
    expect(rec.durationMs ?? 0).toBeGreaterThan(5_000);
    const track = (await (await api(member.token, "GET", `/api/v1/recordings/${rec.id}/state`)).json()) as {
      v: number;
      messages: { type: string; snapshot?: { url: string } }[];
    };
    expect(track.v).toBe(1);
    expect(track.messages[0]?.type).toBe("keyframe");
    expect(track.messages.at(-1)?.type).toBe("keyframe");
    expect(track.messages.at(-1)?.snapshot?.url).toContain("/Genesis.2");
    const media = await api(member.token, "GET", `/api/v1/recordings/${rec.id}/media`);
    expect(media.headers.get("content-type")).toMatch(/^video\//);
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    const ended = (await (await api(member.token, "GET", `/api/v1/rooms/${room.id}`)).json()) as { recording?: boolean };
    expect(ended.recording, "the badge's source is gone after Stop").toBeUndefined();

    // The member finds it in the lobby, opens its page and plays it in the reader (042).
    await member.page.goto(`/social/r/${room.id}`);
    await member.page.locator(`[data-recording-id="${rec.id}"] a`).first().click();
    await expect(member.page.locator('[data-action="play-recording"]')).toBeVisible();
    await member.page.locator('[data-action="play-recording"]').click();
    await expect(location(member.page)).toHaveText(new RegExp(`^/Genesis\\.1\\?ctx=social\\.rec\\.${rec.id}`), { timeout: 20_000 });
    await expect
      .poll(() => member.page.locator('[data-window-owner="replay"] video').evaluate((v: HTMLVideoElement) => v.currentTime).catch(() => 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0.5);
    // The reader follows the recording past the move at about 3 seconds.
    await expect(location(member.page)).toHaveText(new RegExp(`^/Genesis\\.2\\?ctx=social\\.rec\\.${rec.id}`), { timeout: 15_000 });
    // Close: the media stops and the context is gone; the reader stays where it is.
    await member.page.locator('[data-action="replay-close"]').click();
    await expect(location(member.page)).toHaveText("/Genesis.2");

    await owner.context.close();
    await member.context.close();
  });
});
