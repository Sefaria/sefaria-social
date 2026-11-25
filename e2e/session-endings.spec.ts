// Spec 050's journey: the room's owner starts a room, a member joins with one press, the owner records with Record, pauses and
// resumes it from the room window, then closes the room: the member is told the room was closed, both are out of it, and one
// recording was saved whose length leaves the pause out. Runs on the harness with the real social server, the relay and LiveKit
// in development mode; Chromium records its fake camera.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
const OWNER: Persona = { id: 7601, name: "Ending Owner" };
const MEMBER: Persona = { id: 7602, name: "Ending Member" };

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
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

const location = (page: Page) => page.locator("[data-harness=location]");

test.describe("ending a session", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(info.project.name !== "desktop" || browserName !== "chromium", "one browser is enough for the journey");
  });

  // @feature SESS-074 Record on and off during a session, on one clock
  // @feature SESS-075 Close, Finish and Leave, and the closed room
  // @feature ROOM-054 Choose at Start what the session is and whether to record it
  test("record, pause and resume from the room window, then Close room: the member is told and one recording is saved", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const owner = await learner(browser, OWNER);
    const member = await learner(browser, MEMBER);

    // Start a room: straight in (spec 049).
    await owner.page.goto("/social/rooms");
    await owner.page.locator("[data-action=start-room]").first().click();
    await owner.page.locator("[data-room-name]").fill("Closing time");
    await owner.page.locator("[data-action=confirm-start-room]").click();
    await expect(owner.page.locator("[data-follow-line]")).toHaveText("You are leading", { timeout: 15_000 });
    const roomId = /social\.room\.([0-9a-f-]{36})/.exec((await location(owner.page).textContent()) ?? "")![1]!;

    // The member joins with one press.
    await member.page.goto(`/social/r/${roomId}`);
    await member.page.locator("[data-action=join]").click();
    await expect(member.page.locator("[data-follow-line]")).toHaveText("Following Ending Owner", { timeout: 15_000 });
    await expect(member.page.locator("button[data-action=end-session]")).toHaveCount(0);
    await expect(member.page.locator("button[data-action=leave-session]")).toHaveText("Leave");

    // Record, pause, resume (AC-001).
    const toggle = owner.page.locator("[data-room-window] button[data-action=record-toggle]");
    await expect(toggle).toHaveText("Record");
    await toggle.click();
    await expect(toggle).toHaveText("Pause recording", { timeout: 15_000 });
    await owner.page.waitForTimeout(3_000);
    await toggle.click();
    await expect(toggle).toHaveText("Resume recording");
    await owner.page.waitForTimeout(4_000);
    await toggle.click();
    await expect(toggle).toHaveText("Pause recording");
    await owner.page.waitForTimeout(2_000);

    // Close room (AC-002): the recording is saved and everyone is out, the member told.
    await expect(owner.page.locator("button[data-action=end-session]")).toHaveText("Close room");
    await owner.page.locator("button[data-action=end-session]").click();
    await owner.page.locator("button[data-action=confirm-end-session]").click();
    await expect(member.page.locator("[data-room-closed]")).toContainText("The room was closed.", { timeout: 20_000 });
    await expect(location(member.page)).not.toHaveText(new RegExp(`ctx=social\\.room\\.${roomId}`));
    await expect(owner.page.locator("[data-room-closed]")).toContainText("The room was closed.", { timeout: 20_000 });

    // One recording, about 5 seconds long: the 4-second pause is not in it.
    let recordings: { status: string; durationMs: number | null }[] = [];
    await expect
      .poll(
        async () => {
          const res = await fetch(`${API}/api/v1/rooms/${roomId}/recordings`, {
            headers: { authorization: `Bearer ${owner.token}` },
          });
          recordings = ((await res.json()) as { recordings: typeof recordings }).recordings;
          return recordings.map((r) => r.status);
        },
        { timeout: 20_000 },
      )
      .toEqual(["ready"]);
    expect(recordings[0]!.durationMs).toBeGreaterThan(4_000);
    expect(recordings[0]!.durationMs).toBeLessThan(8_000);

    // A closed room (AC-004): the owner's Enter starts a new session in it. (A member first is told it was closed only while the
    // relay still holds the room; the room test covers that, since an emptied room may be unloaded.)
    await owner.page.locator("button[data-action=dismiss-closed]").click();
    await owner.page.goto(`/social/r/${roomId}`);
    await owner.page.locator("[data-action=enter]").click();
    await expect(owner.page.locator("[data-follow-line]")).toHaveText("You are leading", { timeout: 20_000 });

    await owner.context.close();
    await member.context.close();
  });
});
