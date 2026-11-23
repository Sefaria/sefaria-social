// Acceptance tests for specs 025 (profiles and follows) and 026 (notifications), L2: real Postgres through the route tree.
// @feature IDENT-100 Person and institution profiles
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type Profile = {
  id: string;
  kind: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  viewerFollows: boolean;
  isOwn: boolean;
  canManage: boolean;
};
type Me = Profile & { administers: { id: string; name: string }[] };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

async function institution(h: H, name: string, admin?: number): Promise<string> {
  const [row] = await h.sql<{ id: string }>(
    "insert into profiles (kind, name, bio) values ('institution', $1, 'A place of learning') returning id",
    [name],
  );
  if (admin) await h.sql("insert into profile_admins (profile_id, user_id) values ($1, $2)", [row!.id, admin]);
  return row!.id;
}

const me = async (h: H, token: string) => (await h.call("GET", "/api/v1/profiles/me", { token })).json as Me;

describe("spec 025: profiles and follows", () => {
  // @ac 025/AC-001
  it("creates the viewer's profile on first use with their name, and saves a new bio", async () => {
    expect(served("GET", "/api/v1/profiles/me"), "GET /api/v1/profiles/me is served").toBeTypeOf("function");
    const h = await load();
    const token = await h.token(4242, { name: "Dina Learner" });
    const first = await h.call("GET", "/api/v1/profiles/me", { token });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      kind: "person",
      name: "Dina Learner",
      bio: "",
      followers: 0,
      following: 0,
      isOwn: true,
      administers: [],
    });
    expect(await h.sql("select count(*)::int as n from profiles where user_id = 4242")).toEqual([{ n: 1 }]);
    const shul = await institution(h, "Kehilat Ohr", 4242);
    const saved = await h.call("PATCH", "/api/v1/profiles/me", { token, body: { bio: "  Daf Yomi every morning  " } });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      name: "Dina Learner",
      bio: "Daf Yomi every morning",
      administers: [{ id: shul, name: "Kehilat Ohr" }],
    });
    expect((await h.call("PATCH", "/api/v1/profiles/me", { token, body: { name: "" } })).status).toBe(400);
    expect((await h.call("PATCH", "/api/v1/profiles/me", { token, body: { bio: "x".repeat(301) } })).status).toBe(400);
  });

  // @feature IDENT-101 A profile page's data: counts, follow state and posts
  // @ac 025/AC-002
  it("reads any profile with its kind, counts, follow state and latest posts; an unknown one is 404", async () => {
    expect(served("GET", "/api/v1/profiles/$profileId"), "GET /api/v1/profiles/$profileId is served").toBeTypeOf("function");
    const h = await load();
    const admin = await h.token(5151, { name: "Gabbai" });
    const viewer = await h.token(4242, { name: "Viewer" });
    const shul = await institution(h, "Beit Midrash Ohel", 5151);
    await h.call("POST", "/api/v1/posts", { token: admin, body: { body: "Shiur moved to 8", asProfileId: shul } });
    await h.call("POST", "/api/v1/posts", { token: admin, body: { body: "Parsha sheet is up", asProfileId: shul } });
    const res = await h.call("GET", `/api/v1/profiles/${shul}`, { token: viewer });
    expect(res.status).toBe(200);
    const data = res.json as { profile: Profile; posts: { body: string }[] };
    expect(data.profile).toMatchObject({
      kind: "institution",
      name: "Beit Midrash Ohel",
      followers: 0,
      viewerFollows: false,
      isOwn: false,
      canManage: false,
    });
    expect(data.posts.map((p) => p.body)).toEqual(["Parsha sheet is up", "Shiur moved to 8"]);
    const asAdmin = (await h.call("GET", `/api/v1/profiles/${shul}`, { token: admin })).json as { profile: Profile };
    expect(asAdmin.profile.canManage).toBe(true);
    const missing = await h.call("GET", `/api/v1/profiles/${MISSING}`, { token: viewer });
    expect([missing.status, (missing.json as { error: { code: string } }).error.code]).toEqual([404, "profile.not_found"]);
  });

  // @feature IDENT-102 One-tap follow
  // @ac 025/AC-003
  it("follows idempotently, unfollows, and refuses following oneself", async () => {
    expect(served("PUT", "/api/v1/profiles/$profileId/follow"), "PUT follow is served").toBeTypeOf("function");
    const h = await load();
    const teacher = await h.token(5151, { name: "Teacher" });
    const learner = await h.token(4242, { name: "Learner" });
    const tp = await me(h, teacher);
    expect((await h.call("PUT", `/api/v1/profiles/${tp.id}/follow`, { token: learner })).json).toEqual({
      following: true,
      followers: 1,
    });
    expect((await h.call("PUT", `/api/v1/profiles/${tp.id}/follow`, { token: learner })).json).toEqual({
      following: true,
      followers: 1,
    });
    expect((await me(h, learner)).following).toBe(1);
    expect((await h.call("DELETE", `/api/v1/profiles/${tp.id}/follow`, { token: learner })).json).toEqual({
      following: false,
      followers: 0,
    });
    const self = await h.call("PUT", `/api/v1/profiles/${tp.id}/follow`, { token: teacher });
    expect([self.status, (self.json as { error: { code: string } }).error.code]).toEqual([400, "follow.self"]);
    expect((await h.call("PUT", `/api/v1/profiles/${MISSING}/follow`, { token: learner })).status).toBe(404);
  });

  // @feature IDENT-103 Who to follow
  // @ac 025/AC-004
  it("suggests up to 6 profiles, institutions first, never one already followed or the viewer's own", async () => {
    expect(served("GET", "/api/v1/profiles"), "GET /api/v1/profiles is served").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    await me(h, viewer);
    const followed = await institution(h, "Already Followed");
    await institution(h, "Yeshiva Alef");
    await institution(h, "Shul Bet");
    const people: string[] = [];
    for (const [id, name] of [
      [7001, "Popular"],
      [7002, "Quiet"],
      [7003, "Third"],
      [7004, "Fourth"],
      [7005, "Fifth"],
    ] as const)
      people.push((await me(h, await h.token(id, { name }))).id);
    await h.call("PUT", `/api/v1/profiles/${followed}/follow`, { token: viewer });
    await h.call("PUT", `/api/v1/profiles/${people[0]}/follow`, { token: await h.token(7002) });
    await h.call("PUT", `/api/v1/profiles/${people[0]}/follow`, { token: await h.token(7003) });
    const res = await h.call("GET", "/api/v1/profiles?suggested=1", { token: viewer });
    expect(res.status).toBe(200);
    const names = (res.json as { profiles: Profile[] }).profiles.map((p) => p.name);
    expect(names).toHaveLength(6);
    expect(names.slice(0, 3)).toEqual(["Shul Bet", "Yeshiva Alef", "Popular"]);
    expect(names).not.toContain("Already Followed");
    expect(names).not.toContain("Viewer");
  });
});

describe("spec 026: notifications", () => {
  // @feature FEED-066 Notifications for follows, replies, reactions and new posts
  // @ac 026/AC-001
  it("notifies the right people of follows, replies, reactions and posts, and nobody of their own action", async () => {
    expect(served("GET", "/api/v1/notifications"), "GET /api/v1/notifications is served").toBeTypeOf("function");
    const h = await load();
    const teacher = await h.token(5151, { name: "Teacher" });
    const learner = await h.token(4242, { name: "Learner" });
    const gabbai = await h.token(6161, { name: "Gabbai" });
    const fan = await h.token(7171, { name: "Fan" });
    const tp = await me(h, teacher);
    const shul = await institution(h, "Shul", 6161);
    await h.call("PUT", `/api/v1/profiles/${tp.id}/follow`, { token: learner });
    await h.call("PUT", `/api/v1/profiles/${shul}/follow`, { token: fan });
    const p = (await h.call("POST", "/api/v1/posts", { token: teacher, body: { body: "Teacher's thought" } })).json as {
      id: string;
    };
    await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: learner, body: { body: "Beautiful" } });
    await h.call("PUT", `/api/v1/posts/${p.id}/reaction`, { token: learner });
    await h.call("DELETE", `/api/v1/posts/${p.id}/reaction`, { token: learner });
    await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: teacher, body: { body: "Thanks" } });
    await h.call("POST", "/api/v1/posts", { token: gabbai, body: { body: "Kiddush after davening", asProfileId: shul } });
    const kinds = async (token: string) =>
      (
        (await h.call("GET", "/api/v1/notifications", { token })).json as {
          notifications: { kind: string; actor: { name: string } | null }[];
        }
      ).notifications.map((n) => `${n.kind}:${n.actor?.name}`);
    expect(await kinds(teacher)).toEqual(["reaction:Learner", "reply:Learner", "follow:Learner"]);
    expect(await kinds(learner)).toEqual(["post:Teacher"]);
    expect(await kinds(fan)).toEqual(["post:Shul"]);
    expect(await kinds(gabbai)).toEqual(["follow:Fan"]);
  });

  // @feature FEED-067 The notifications list, unread count and marking read
  // @ac 026/AC-002
  it("lists notifications newest first with the post they are about and the unread count; marking read clears it", async () => {
    expect(served("POST", "/api/v1/notifications/read"), "POST /api/v1/notifications/read is served").toBeTypeOf("function");
    const h = await load();
    const teacher = await h.token(5151, { name: "Teacher" });
    const learner = await h.token(4242, { name: "Learner" });
    const tp = await me(h, teacher);
    await h.call("PUT", `/api/v1/profiles/${tp.id}/follow`, { token: learner });
    const p = (await h.call("POST", "/api/v1/posts", { token: teacher, body: { body: "On the first verse" } })).json as {
      id: string;
    };
    await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: learner, body: { body: "Yes" } });
    await h.call("PUT", `/api/v1/posts/${p.id}/reaction`, { token: learner });
    const res = await h.call("GET", "/api/v1/notifications", { token: teacher });
    expect(res.status).toBe(200);
    const data = res.json as {
      notifications: { kind: string; read: boolean; post: { id: string; snippet: string } | null }[];
      unread: number;
    };
    expect(data.unread).toBe(3);
    expect(data.notifications.map((n) => n.kind)).toEqual(["reaction", "reply", "follow"]);
    expect(data.notifications[0]!.post).toEqual({ id: p.id, snippet: "On the first verse" });
    expect(data.notifications.every((n) => !n.read)).toBe(true);
    expect((await h.call("POST", "/api/v1/notifications/read", { token: teacher })).json).toEqual({ unread: 0 });
    const after = (await h.call("GET", "/api/v1/notifications", { token: teacher })).json as typeof data;
    expect([after.unread, after.notifications.every((n) => n.read)]).toEqual([0, true]);
  });
});
