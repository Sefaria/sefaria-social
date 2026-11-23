// The social journeys of specs 023–027 (L4a): the built surface in the harness (the fake reader) with the real social server,
// Postgres and tokens verified against the stack's JWKS. Every test uses its own invented people, so tests can run in parallel
// on the shared database; institutions (which have no create endpoint) are inserted with SQL, as staff or the demo seed would.
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { STACK } from "./stack/config";
import { tokenFor, type Persona } from "./stack/tokens";

const API = `http://127.0.0.1:${STACK.apiPort}`;
let next = 960000 + Math.floor(Math.random() * 10000) * 10;
const persona = (name: string): Persona => ({ id: next++, name });

async function as(browser: Browser, who: Persona, extra: Record<string, unknown> = {}) {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const token = await tokenFor(who);
  await context.addInitScript((config) => Object.assign(window, { __HARNESS_CONFIG__: config }), {
    viewer: { id: who.id, name: who.name },
    token,
    apiOrigin: API,
    relayOrigin: `ws://127.0.0.1:${STACK.relayPort}`,
    ...extra,
  });
  return { context, page: await context.newPage(), token };
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (res.status === 204 ? null : await res.json()) as Record<string, unknown> & { id: string };
}

async function institution(name: string, admin?: number): Promise<string> {
  const client = new pg.Client({ connectionString: STACK.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "insert into profiles (kind, name, bio) values ('institution', $1, 'A place of learning') returning id",
      [name],
    );
    if (admin) await client.query("insert into profile_admins (profile_id, user_id) values ($1, $2)", [rows[0]!.id, admin]);
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

const mount = (page: Page) => page.locator("[data-surface-mount=page]");
const location = (page: Page) => page.locator("[data-harness=location]");
const postWith = (page: Page, text: string) => mount(page).locator("article[data-post]", { hasText: text });

test.describe("posts, replies and Yasher koach", () => {
  // @feature FEED-063 The composer and the timeline on /social
  // @ac 023/AC-004
  // @feature FEED-062 A post's own page and deleting a post
  // @ac 023/AC-005
  test("a learner posts a thought anchored to a source; it tops Following; its page shows the source and replies", async ({
    browser,
  }) => {
    const me = persona("Composer Learner");
    const { page, context } = await as(browser, me);
    await page.goto("/social");
    const composer = mount(page).locator("[data-composer]");
    await expect(composer.locator("[data-action=post]")).toBeDisabled();
    const thought = `Light before the luminaries ${me.id}`;
    await composer.locator("[data-composer-body]").fill(thought);
    await composer.locator("[data-composer-ref]").fill("Genesis 1:3");
    await composer.locator("[data-action=post]").click();
    const first = mount(page).locator("[data-timeline=following] article[data-post]").first();
    await expect(first.locator("[data-post-body]")).toHaveText(thought);
    await expect(first.locator("[data-post-source]")).toHaveAttribute("data-post-source", "Genesis 1:3");
    await expect(composer.locator("[data-composer-body]")).toHaveValue("");

    await mount(page).locator("[data-timeline-tab=everyone]").click();
    await expect(postWith(page, thought)).toHaveCount(1);

    await postWith(page, thought).locator("[data-post-link]").click();
    await expect(page).toHaveURL(/\/social\/p\/[0-9a-f-]{36}$/);
    await expect(mount(page).locator("[data-social-page=post] [data-post-body]")).toHaveText(thought);
    await mount(page).locator("[data-post-source] a").click();
    await expect(location(page)).toHaveText(/^\/Genesis/);
    await page.goBack();
    await page.goto("/social/p/6f1c2d3e-4b5a-4c6d-8e7f-001122334455");
    await expect(mount(page).locator("[data-post-missing]")).toBeVisible();
    await context.close();
  });

  // @feature FEED-065 Yasher koach: one reaction per person, optimistic in the interface
  // @ac 024/AC-003
  // @feature FEED-064 Replies under a post
  // @ac 024/AC-004
  test("Yasher koach shows at once; replies appear in order and only their author can delete them", async ({ browser }) => {
    const author = persona("Thread Author");
    const reader = persona("Thread Reader");
    const authorToken = await tokenFor(author);
    const post = await api(authorToken, "POST", "/api/v1/posts", { body: `Why does Rashi begin here? ${author.id}` });
    await api(authorToken, "POST", `/api/v1/posts/${post.id}/replies`, { body: "First, from the author" });
    const { page, context } = await as(browser, reader);
    await page.goto(`/social/p/${post.id}`);
    const react = mount(page).locator("[data-action=react]");
    await expect(react).toHaveAttribute("aria-pressed", "false");
    await react.click();
    await expect(react).toHaveAttribute("aria-pressed", "true");
    await expect(react.locator("[data-reaction-count]")).toHaveText("1");
    await expect(react.locator("svg")).toHaveAttribute("data-icon", "sparkFilled");

    await mount(page).locator("[data-reply-body]").fill("Second, from the reader");
    await mount(page).locator("[data-action=reply]").click();
    const replies = mount(page).locator("[data-replies] article[data-reply]");
    await expect(replies).toHaveCount(2);
    await expect(replies.nth(1)).toContainText("Second, from the reader");
    await expect(mount(page).locator("[data-reply-count]")).toContainText("2 replies");
    await expect(replies.nth(0).locator("[data-action=delete-reply]")).toHaveCount(0);
    await expect(replies.nth(1).locator("[data-action=delete-reply]")).toHaveCount(1);
    await page.reload();
    await expect(mount(page).locator("[data-action=react]")).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });
});

test.describe("profiles and follows", () => {
  // @feature IDENT-101 A profile page: kind, bio, counts, follow state and posts
  // @ac 025/AC-005
  test("following from Who to follow turns the button at once; the profile page shows kind, bio, counts and posts", async ({
    browser,
  }) => {
    const me = persona("Follow Learner");
    const name = `Beit Midrash ${me.id}`;
    const admin = persona("Gabbai");
    const id = await institution(name, admin.id);
    await api(await tokenFor(admin), "POST", "/api/v1/posts", { body: `Shiur tonight at 8 (${me.id})`, asProfileId: id });
    const { page, context } = await as(browser, me);
    await page.goto("/social");
    const suggestion = mount(page).locator(`[data-suggestion="${id}"]`);
    await expect(suggestion).toBeVisible();
    await suggestion.locator("[data-action=follow]").click();
    await expect(suggestion.locator("[data-action=follow]")).toHaveAttribute("aria-pressed", "true");
    await suggestion.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`/social/u/${id}$`));
    const profile = mount(page).locator("[data-social-page=profile]");
    await expect(profile.locator("h1")).toHaveText(name);
    await expect(profile.getByText("Community", { exact: true }).first()).toBeVisible();
    await expect(profile.locator("[data-profile-bio]")).toHaveText("A place of learning");
    await expect(profile.locator("[data-profile-followers]")).toHaveText("1 follower");
    await expect(profile.locator("[data-action=follow]")).toHaveAttribute("aria-pressed", "true");
    await expect(profile.locator("article[data-post]")).toContainText(`Shiur tonight at 8 (${me.id})`);
    await mount(page).locator("[data-nav=profile]").click();
    await expect(mount(page).locator("[data-action=edit-profile]")).toBeVisible();
    await expect(mount(page).locator("[data-social-page=profile] [data-action=follow]")).toHaveCount(0);
    await context.close();
  });

  // @feature IDENT-100 Person and institution profiles
  // @ac 025/AC-006
  test("a learner saves a bio and posts as the beit midrash they run", async ({ browser }) => {
    const me = persona("Gabbai Learner");
    const shul = `Kehilat ${me.id}`;
    const id = await institution(shul, me.id);
    const { page, context } = await as(browser, me);
    await page.goto("/social/settings?tab=profile");
    const form = mount(page).locator("[data-profile-form]");
    await form.locator("[data-profile-bio-input]").fill("Daf Yomi every morning");
    await form.locator("[data-action=save-profile]").click();
    await expect(form.locator("[data-profile-status]")).toHaveText("Saved.");
    await page.goto("/social");
    const as_ = mount(page).locator("[data-composer-as]");
    await expect(as_.locator("option")).toHaveText([me.name, shul]);
    await as_.selectOption(id);
    await mount(page).locator("[data-composer-body]").fill(`Kiddush after davening ${me.id}`);
    await mount(page).locator("[data-action=post]").click();
    const first = mount(page).locator("[data-timeline] article[data-post]").first();
    await expect(first.locator("[data-post-author]")).toHaveText(shul);
    await context.close();
  });
});

test.describe("activity", () => {
  // @feature FEED-067 The notifications list, unread count and the activity page
  // @ac 026/AC-003
  // @ac 026/AC-004
  test("the unread badge counts what happened; the activity page links to it and clears the badge", async ({ browser }) => {
    const teacher = persona("Badge Teacher");
    const fan = persona("Badge Fan");
    const teacherToken = await tokenFor(teacher);
    const fanToken = await tokenFor(fan);
    const me = await api(teacherToken, "GET", "/api/v1/profiles/me");
    const post = await api(teacherToken, "POST", "/api/v1/posts", { body: `On the first verse ${teacher.id}` });
    await api(fanToken, "PUT", `/api/v1/profiles/${me.id}/follow`);
    await api(fanToken, "POST", `/api/v1/posts/${post.id}/replies`, { body: "Beautiful" });
    const { page, context } = await as(browser, teacher);
    await page.goto("/social");
    const activity = mount(page).locator("[data-nav=activity]");
    await expect(activity.locator("[data-unread]")).toHaveText("2");
    await expect(activity).toHaveAccessibleName(/Activity, 2 unread/);
    await activity.click();
    const items = mount(page).locator("[data-activity-list] li");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(`${fan.name} replied to your post`);
    await expect(items.nth(1)).toContainText(`${fan.name} followed you`);
    await expect(items.nth(0)).toHaveAttribute("data-read", "false");
    await expect(activity.locator("[data-unread]")).toHaveCount(0);
    await items.nth(0).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/social/p/${post.id}$`));
    await context.close();
  });
});

test.describe("sharing", () => {
  // @feature FEED-068 Share a post or a profile
  // @ac 027/AC-001
  // @ac 027/AC-002
  test("Share offers copy, WhatsApp and email with the post's absolute link; copying announces it; Escape returns focus", async ({
    browser,
  }) => {
    const me = persona("Share Learner");
    const post = await api(await tokenFor(me), "POST", "/api/v1/posts", {
      body: `What is hateful to you ${me.id}`,
      ref: "Shabbat 31a",
    });
    const { page, context } = await as(browser, me);
    await page.goto(`/social/p/${post.id}`);
    const share = mount(page).locator("[data-share]").first();
    await share.locator("[data-action=share]").click();
    const menu = share.locator("[data-share-menu]");
    await expect(menu.locator("[data-share-item]")).toHaveText(
      ["Copy link", "WhatsApp", "Email"].concat((await menu.locator("[data-share-item=native]").count()) ? ["Share…"] : []),
    );
    const link = `http://localhost:${new URL(page.url()).port}/social/p/${post.id}`;
    const wa = await menu.locator("[data-share-item=whatsapp]").getAttribute("href");
    expect(decodeURIComponent(wa!.replace("https://wa.me/?text=", ""))).toBe(`What is hateful to you ${me.id}\n${link}`);
    expect(await menu.locator("[data-share-item=email]").getAttribute("href")).toContain(encodeURIComponent(link));
    await menu.locator("[data-share-item=copy]").click();
    await expect(share.locator("[data-share-status]")).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await share.locator("[data-action=share]").click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(share.locator("[data-action=share]")).toBeFocused();
    await context.close();
  });
});

test.describe("Hebrew interface", () => {
  // @feature FEED-063 The composer and the timeline on /social
  // @ac 023/AC-006
  test("right to left, posts keep their own direction, times in Hebrew with the full date in datetime", async ({ browser }) => {
    const me = persona("Hebrew Learner");
    await api(await tokenFor(me), "POST", "/api/v1/posts", { body: `An English thought ${me.id}` });
    const { page, context } = await as(browser, me, { interfaceLang: "hebrew" });
    await page.goto("/social");
    await expect(mount(page).locator("[data-social-root]")).toHaveAttribute("dir", "rtl");
    await expect(mount(page).locator("[data-timeline-tab=following]")).toHaveText("נעקבים");
    const post = postWith(page, `An English thought ${me.id}`);
    await expect(post.locator("[data-post-body]")).toHaveAttribute("dir", "auto");
    await expect(post.locator("time")).toHaveText("עכשיו");
    expect(Date.parse((await post.locator("time").getAttribute("datetime"))!)).not.toBeNaN();
    await mount(page).locator("[data-timeline-tab=following]").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(mount(page).locator("[data-timeline-tab=everyone]")).toBeFocused();
    await context.close();
  });
});
