// Acceptance tests for specs 023 (posts and the timeline) and 024 (replies and reactions), L2: real Postgres through the
// route tree. Institutions have no create endpoint (staff or the demo seed make them), so tests insert one with SQL.
// @feature FEED-060 Posts with an optional source, written as a person or an institution
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
type Post = {
  id: string;
  body: string;
  ref: string | null;
  author: { id: string; kind: string; name: string };
  replyCount: number;
  reactionCount: number;
  reacted: boolean;
  canDelete: boolean;
};
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

async function institution(h: H, name: string, admin?: number): Promise<string> {
  const [row] = await h.sql<{ id: string }>(
    "insert into profiles (kind, name, bio) values ('institution', $1, '') returning id",
    [name],
  );
  if (admin) await h.sql("insert into profile_admins (profile_id, user_id) values ($1, $2)", [row!.id, admin]);
  return row!.id;
}

async function post(h: H, token: string, body: Record<string, unknown>) {
  return h.call("POST", "/api/v1/posts", { token, body });
}

describe("spec 023: posts and the timeline", () => {
  // @ac 023/AC-001
  it("stores a post as the viewer's profile with its source, refuses bad input and posting as someone else's institution", async () => {
    expect(served("POST", "/api/v1/posts"), "POST /api/v1/posts is served").toBeTypeOf("function");
    const h = await load();
    const me = await h.token(4242, { name: "Dina Learner" });
    const res = await post(h, me, { body: "  Light came before the luminaries  ", ref: "Genesis 1:3" });
    expect(res.status).toBe(201);
    const p = res.json as Post;
    expect(p).toMatchObject({
      body: "Light came before the luminaries",
      ref: "Genesis 1:3",
      author: { kind: "person", name: "Dina Learner" },
      replyCount: 0,
      reactionCount: 0,
      reacted: false,
      canDelete: true,
    });
    expect((await post(h, me, { body: "   " })).status).toBe(400);
    expect((await post(h, me, { body: "x".repeat(2001) })).status).toBe(400);
    const notMine = await institution(h, "Beit Midrash Ohel", 5151);
    const refused = await post(h, me, { body: "As them", asProfileId: notMine });
    expect([refused.status, (refused.json as { error: { code: string } }).error.code]).toEqual([403, "post.forbidden"]);
    const mine = await institution(h, "My Shul", 4242);
    const asShul = await post(h, me, { body: "Shabbat shiur at 5", asProfileId: mine });
    expect([asShul.status, (asShul.json as Post).author]).toEqual([201, { id: mine, kind: "institution", name: "My Shul" }]);
  });

  // @feature FEED-061 The timeline: Following and Everyone, newest first, in pages
  // @ac 023/AC-002
  it("Following holds followed profiles' posts and the viewer's own, Everyone holds all, newest first, 20 a page", async () => {
    expect(served("GET", "/api/v1/timeline"), "GET /api/v1/timeline is served").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    const teacher = await h.token(5151, { name: "Teacher" });
    const stranger = await h.token(6161, { name: "Stranger" });
    const t = (await post(h, teacher, { body: "teacher 1" })).json as Post;
    await post(h, stranger, { body: "stranger 1" });
    await post(h, viewer, { body: "viewer 1" });
    const gone = (await post(h, teacher, { body: "deleted" })).json as Post;
    expect((await h.call("DELETE", `/api/v1/posts/${gone.id}`, { token: teacher })).status).toBe(204);
    expect((await h.call("PUT", `/api/v1/profiles/${t.author.id}/follow`, { token: viewer })).status).toBe(200);
    const following = await h.call("GET", "/api/v1/timeline?tab=following", { token: viewer });
    expect(following.status).toBe(200);
    expect((following.json as { posts: Post[] }).posts.map((p) => p.body)).toEqual(["viewer 1", "teacher 1"]);
    const everyone = await h.call("GET", "/api/v1/timeline?tab=everyone", { token: viewer });
    expect((everyone.json as { posts: Post[] }).posts.map((p) => p.body)).toEqual(["viewer 1", "stranger 1", "teacher 1"]);

    for (let i = 0; i < 22; i++) await post(h, viewer, { body: `page ${i}` });
    const first = (await h.call("GET", "/api/v1/timeline?tab=everyone", { token: viewer })).json as {
      posts: Post[];
      nextCursor: string | null;
    };
    expect(first.posts).toHaveLength(20);
    expect(first.posts[0]!.body).toBe("page 21");
    expect(first.nextCursor).toBeTypeOf("string");
    const second = (await h.call("GET", `/api/v1/timeline?tab=everyone&before=${first.nextCursor}`, { token: viewer })).json as {
      posts: Post[];
      nextCursor: string | null;
    };
    expect(second.posts.map((p) => p.body)).toEqual(["page 1", "page 0", "viewer 1", "stranger 1", "teacher 1"]);
    expect(second.nextCursor).toBeNull();
    expect((await h.call("GET", "/api/v1/timeline?tab=nope", { token: viewer })).status).toBe(400);
  });

  // @feature FEED-062 A post's own page data and deleting a post
  // @ac 023/AC-003
  it("reads one post with its replies oldest first; only its author deletes it; a deleted post is 404", async () => {
    expect(served("GET", "/api/v1/posts/$postId"), "GET /api/v1/posts/$postId is served").toBeTypeOf("function");
    const h = await load();
    const author = await h.token(4242, { name: "Author" });
    const reader = await h.token(5151, { name: "Reader" });
    const p = (await post(h, author, { body: "Why does Rashi start here?", ref: "Genesis 1:1" })).json as Post;
    await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: reader, body: { body: "first" } });
    await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: author, body: { body: "second" } });
    const read = await h.call("GET", `/api/v1/posts/${p.id}`, { token: reader });
    expect(read.status).toBe(200);
    const data = read.json as { post: Post; replies: { body: string }[] };
    expect([data.post.replyCount, data.post.canDelete, data.replies.map((r) => r.body)]).toEqual([2, false, ["first", "second"]]);
    const refused = await h.call("DELETE", `/api/v1/posts/${p.id}`, { token: reader });
    expect([refused.status, (refused.json as { error: { code: string } }).error.code]).toEqual([403, "post.forbidden"]);
    expect((await h.call("DELETE", `/api/v1/posts/${p.id}`, { token: author })).status).toBe(204);
    const after = await h.call("GET", `/api/v1/posts/${p.id}`, { token: author });
    expect([after.status, (after.json as { error: { code: string } }).error.code]).toEqual([404, "post.not_found"]);
    expect((await h.call("GET", `/api/v1/posts/${MISSING}`, { token: author })).status).toBe(404);
  });
});

describe("spec 024: replies and reactions", () => {
  // @feature FEED-064 Replies under a post
  // @ac 024/AC-001
  it("stores a reply under a post and counts it; only its author deletes it; replies to a missing post or empty are refused", async () => {
    expect(served("POST", "/api/v1/posts/$postId/replies"), "POST replies is served").toBeTypeOf("function");
    const h = await load();
    const author = await h.token(4242, { name: "Author" });
    const replier = await h.token(5151, { name: "Replier" });
    const p = (await post(h, author, { body: "A question" })).json as Post;
    const res = await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: replier, body: { body: "  An answer  " } });
    expect(res.status).toBe(201);
    const reply = res.json as { id: string; body: string; author: { name: string }; canDelete: boolean };
    expect([reply.body, reply.author.name, reply.canDelete]).toEqual(["An answer", "Replier", true]);
    expect(((await h.call("GET", `/api/v1/posts/${p.id}`, { token: author })).json as { post: Post }).post.replyCount).toBe(1);
    expect((await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token: replier, body: { body: " " } })).status).toBe(400);
    expect((await h.call("POST", `/api/v1/posts/${MISSING}/replies`, { token: replier, body: { body: "x" } })).status).toBe(404);
    const refused = await h.call("DELETE", `/api/v1/replies/${reply.id}`, { token: author });
    expect([refused.status, (refused.json as { error: { code: string } }).error.code]).toEqual([403, "reply.forbidden"]);
    expect((await h.call("DELETE", `/api/v1/replies/${reply.id}`, { token: replier })).status).toBe(204);
    expect(((await h.call("GET", `/api/v1/posts/${p.id}`, { token: author })).json as { post: Post }).post.replyCount).toBe(0);
  });

  // @feature FEED-065 Yasher koach: one reaction per person, optimistic in the interface
  // @ac 024/AC-002
  it("reacting twice counts once, removing takes it back, and a missing post is 404", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/reaction"), "PUT reaction is served").toBeTypeOf("function");
    const h = await load();
    const author = await h.token(4242);
    const fan = await h.token(5151);
    const p = (await post(h, author, { body: "Yasher koach?" })).json as Post;
    expect((await h.call("PUT", `/api/v1/posts/${p.id}/reaction`, { token: fan })).json).toEqual({
      reacted: true,
      reactionCount: 1,
    });
    expect((await h.call("PUT", `/api/v1/posts/${p.id}/reaction`, { token: fan })).json).toEqual({
      reacted: true,
      reactionCount: 1,
    });
    const seen = (await h.call("GET", "/api/v1/timeline?tab=everyone", { token: fan })).json as { posts: Post[] };
    expect([seen.posts[0]!.reacted, seen.posts[0]!.reactionCount]).toEqual([true, 1]);
    expect((await h.call("DELETE", `/api/v1/posts/${p.id}/reaction`, { token: fan })).json).toEqual({
      reacted: false,
      reactionCount: 0,
    });
    expect((await h.call("PUT", `/api/v1/posts/${MISSING}/reaction`, { token: fan })).status).toBe(404);
  });
});
