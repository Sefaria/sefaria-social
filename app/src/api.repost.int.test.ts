// Acceptance tests for spec 030 (reposts and quotes) and spec 031 (For you and the conversation), L2: real Postgres through
// the route tree.
// @feature FEED-070 Repost a post
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
type Author = { id: string; name: string };
type Post = {
  id: string;
  body: string;
  author: Author;
  repostCount?: number;
  quoteCount?: number;
  reposted?: boolean;
  quoted?: { id: string; body: string | null; author: Author | null } | null;
  repostedBy?: Author | null;
};
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const post = async (h: H, token: string, body: Record<string, unknown>) =>
  (await h.call("POST", "/api/v1/posts", { token, body })).json as Post;
const page = async (h: H, token: string, tab: string) =>
  ((await h.call("GET", `/api/v1/timeline?tab=${tab}`, { token })).json as { posts: Post[] }).posts;

describe("spec 030: reposts and quotes", () => {
  // @ac 030/AC-001
  it("records one repost per profile, counts it, undoes it, and refuses a missing post", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served").toBeTypeOf("function");
    const h = await load();
    const teacher = await h.token(5151, { name: "Teacher" });
    const learner = await h.token(4242, { name: "Learner" });
    const p = await post(h, teacher, { body: "A thought" });
    const first = await h.call("PUT", `/api/v1/posts/${p.id}/repost`, { token: learner });
    const again = await h.call("PUT", `/api/v1/posts/${p.id}/repost`, { token: learner });
    expect([first.status, first.json, again.json]).toEqual([
      200,
      { reposted: true, repostCount: 1 },
      { reposted: true, repostCount: 1 },
    ]);
    const read = (await h.call("GET", `/api/v1/posts/${p.id}`, { token: learner })).json as { post: Post };
    expect([read.post.repostCount, read.post.reposted, read.post.quoteCount]).toEqual([1, true, 0]);
    expect((await h.call("DELETE", `/api/v1/posts/${p.id}/repost`, { token: learner })).json).toEqual({
      reposted: false,
      repostCount: 0,
    });
    expect((await h.call("PUT", `/api/v1/posts/${MISSING}/repost`, { token: learner })).status).toBe(404);
  });

  // @feature FEED-071 Quote a post
  // @ac 030/AC-002
  it("stores a quote carrying the quoted post, counts it, keeps it when the original goes, and refuses a missing one", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served (spec 030)").toBeTypeOf("function");
    const h = await load();
    const teacher = await h.token(5151, { name: "Teacher" });
    const learner = await h.token(4242, { name: "Learner" });
    const original = await post(h, teacher, { body: "Rashi starts with belonging" });
    const quote = await post(h, learner, { body: "Next to the Ramban", quotedPostId: original.id });
    expect(quote.quoted).toMatchObject({ id: original.id, body: "Rashi starts with belonging", author: { name: "Teacher" } });
    const read = (await h.call("GET", `/api/v1/posts/${original.id}`, { token: learner })).json as { post: Post };
    expect(read.post.quoteCount).toBe(1);
    expect((await h.call("DELETE", `/api/v1/posts/${original.id}`, { token: teacher })).status).toBe(204);
    const after = (await h.call("GET", `/api/v1/posts/${quote.id}`, { token: learner })).json as { post: Post };
    expect(after.post.quoted).toEqual({ id: original.id, body: null, ref: null, author: null, createdAt: null });
    expect((await h.call("POST", "/api/v1/posts", { token: learner, body: { body: "x", quotedPostId: MISSING } })).status).toBe(
      404,
    );
  });

  // @feature FEED-070 Repost a post
  // @ac 030/AC-003
  it("puts the network's reposts in Following, saying who reposted, once per post", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    const friend = await h.token(5151, { name: "Friend" });
    const stranger = await h.token(6161, { name: "Stranger" });
    const theirs = await post(h, stranger, { body: "A stranger's thought" });
    const mine = await post(h, friend, { body: "The friend's own" });
    await h.call("PUT", `/api/v1/profiles/${mine.author.id}/follow`, { token: viewer });
    expect((await page(h, viewer, "following")).map((p) => p.body)).toEqual(["The friend's own"]);
    await h.call("PUT", `/api/v1/posts/${theirs.id}/repost`, { token: friend });
    await h.call("PUT", `/api/v1/posts/${mine.id}/repost`, { token: friend });
    const following = await page(h, viewer, "following");
    expect(following.map((p) => [p.body, p.repostedBy?.name ?? null])).toEqual([
      ["The friend's own", "Friend"],
      ["A stranger's thought", "Friend"],
    ]);
  });
});

describe("spec 031: For you and the conversation", () => {
  // @feature FEED-072 For you: the timeline ranked like X's
  // @ac 031/AC-001
  it("ranks an engaged post above a newer quiet one, and a stranger's quiet post below both", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served (spec 030)").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    const t1 = await h.token(5151, { name: "Teacher One" });
    const t2 = await h.token(5252, { name: "Teacher Two" });
    const stranger = await h.token(6161, { name: "Stranger" });
    const fans = await Promise.all([7001, 7002, 7003].map((u) => h.token(u, { name: `Fan ${u}` })));
    const engaged = await post(h, t1, { body: "engaged" });
    const quiet = await post(h, t2, { body: "quiet" });
    const far = await post(h, stranger, { body: "stranger quiet" });
    for (const p of [engaged, quiet]) await h.call("PUT", `/api/v1/profiles/${p.author.id}/follow`, { token: viewer });
    for (const fan of fans) await h.call("POST", `/api/v1/posts/${engaged.id}/replies`, { token: fan, body: { body: "yes" } });
    await h.call("PUT", `/api/v1/posts/${engaged.id}/repost`, { token: fans[0]! });
    const ranked = (await page(h, viewer, "everyone")).map((p) => p.id);
    expect(ranked.indexOf(engaged.id)).toBeLessThan(ranked.indexOf(quiet.id));
    expect(ranked.indexOf(quiet.id)).toBeLessThan(ranked.indexOf(far.id));
  });

  // @ac 031/AC-002
  it("does not let one author fill the page", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served (spec 030)").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    const other = await h.token(5252, { name: "Other" });
    const busy = await h.token(5151, { name: "Busy" });
    const lone = await post(h, other, { body: "the only one" });
    const many = [];
    for (let i = 0; i < 4; i++) many.push(await post(h, busy, { body: `busy ${i}` }));
    for (const p of [lone, many[0]!]) await h.call("PUT", `/api/v1/profiles/${p.author.id}/follow`, { token: viewer });
    const ranked = (await page(h, viewer, "everyone")).map((p) => p.body);
    expect(ranked.indexOf("the only one")).toBeLessThanOrEqual(1);
  });

  // @feature FEED-073 The conversation, ordered like X's
  // @ac 031/AC-003
  it("orders replies: the author's, then followed profiles', then the rest", async () => {
    expect(served("PUT", "/api/v1/posts/$postId/repost"), "PUT repost is served (spec 030)").toBeTypeOf("function");
    const h = await load();
    const viewer = await h.token(4242, { name: "Viewer" });
    const author = await h.token(5151, { name: "Author" });
    const friend = await h.token(5252, { name: "Friend" });
    const stranger = await h.token(6161, { name: "Stranger" });
    const p = await post(h, author, { body: "A question" });
    const friendPost = await post(h, friend, { body: "hello" });
    await h.call("PUT", `/api/v1/profiles/${friendPost.author.id}/follow`, { token: viewer });
    for (const [token, body] of [
      [stranger, "from a stranger"],
      [friend, "from a friend"],
      [author, "from the author"],
    ] as const)
      await h.call("POST", `/api/v1/posts/${p.id}/replies`, { token, body: { body } });
    const read = (await h.call("GET", `/api/v1/posts/${p.id}`, { token: viewer })).json as { replies: { body: string }[] };
    expect(read.replies.map((r) => r.body)).toEqual(["from the author", "from a friend", "from a stranger"]);
  });
});
