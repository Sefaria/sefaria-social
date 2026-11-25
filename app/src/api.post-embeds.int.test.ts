// Acceptance tests for spec 055 (links in posts), L2: real Postgres through the route tree. A post may embed a room, a
// broadcast or a recording; the server checks the target and answers its title and leader; a post without one is unchanged.
// @feature FEED-074 A post may embed a room, broadcast or recording, checked by the server
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type Embed = { kind: string; id: string; title: string | null; leader: string | null };
type Post = { id: string; body: string; embed?: Embed };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

/** The fields a post had before spec 055, in the order the API writes them. */
const POST_KEYS = [
  "id",
  "body",
  "ref",
  "author",
  "createdAt",
  "replyCount",
  "reactionCount",
  "reacted",
  "canDelete",
  "repostCount",
  "quoteCount",
  "reposted",
  "quoted",
  "repostedBy",
];

async function session(h: H) {
  const owner = await h.token(4242, { name: "Rav Owner" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Daf Yomi together" } })).json as {
    id: string;
  };
  const broadcast = (await h.call("POST", `/api/v1/rooms/${room.id}/broadcasts`, { token: owner })).json as { id: string };
  const recording = (await h.call("POST", `/api/v1/rooms/${room.id}/recordings`, { token: owner, body: {} })).json as {
    id: string;
  };
  return { owner, room: room.id, broadcast: broadcast.id, recording: recording.id };
}

describe("spec 055: posts embed a room, broadcast or recording", () => {
  // @ac 055/AC-002
  it("answers a checked embed with its title and leader, refuses an unknown target and empty text without an embed", async () => {
    const h = await load();
    const s = await session(h);
    const reader = await h.token(5151, { name: "Reader" });
    const write = (body: Record<string, unknown>) => h.call("POST", "/api/v1/posts", { token: reader, body });
    // Only someone in the room may post it: an outsider gets the same 404 as for a room that does not exist.
    for (const embed of [
      { kind: "room", id: s.room },
      { kind: "broadcast", id: s.broadcast },
      { kind: "recording", id: s.recording },
    ])
      expect((await write({ body: "Not mine", embed })).status, `outsider posts ${embed.kind}`).toBe(404);
    expect((await h.call("POST", `/api/v1/rooms/${s.room}/members`, { token: reader })).status).toBe(200);

    const room = await write({ body: "Join us", embed: { kind: "room", id: s.room } });
    expect([room.status, (room.json as Post).embed]).toEqual([
      201,
      { kind: "room", id: s.room, title: "Daf Yomi together", leader: "Rav Owner" },
    ]);
    const bcast = await write({ body: "", embed: { kind: "broadcast", id: s.broadcast } });
    expect([bcast.status, (bcast.json as Post).body, (bcast.json as Post).embed]).toEqual([
      201,
      "",
      { kind: "broadcast", id: s.broadcast, title: "Daf Yomi together", leader: "Rav Owner" },
    ]);
    const rec = await write({ body: "Listen", embed: { kind: "recording", id: s.recording } });
    expect([rec.status, (rec.json as Post).embed?.kind, (rec.json as Post).embed?.leader]).toEqual([
      201,
      "recording",
      "Rav Owner",
    ]);

    const before = await h.sql<{ n: number }>("select count(*)::int as n from posts");
    const unknown = await write({ body: "Nowhere", embed: { kind: "room", id: MISSING } });
    expect([unknown.status, (unknown.json as { error: { code: string } }).error.code]).toEqual([404, "embed.not_found"]);
    const wrongKind = await write({ body: "Wrong kind", embed: { kind: "broadcast", id: s.room } });
    expect(wrongKind.status).toBe(404);
    expect(await h.sql("select count(*)::int as n from posts")).toEqual(before);
    expect((await write({ body: "   " })).status).toBe(400);
    expect((await write({ body: "x", embed: { kind: "sheet", id: s.room } })).status).toBe(400);

    const page = (await h.call("GET", "/api/v1/timeline?tab=everyone", { token: reader })).json as { posts: Post[] };
    expect(page.posts.map((p) => p.embed?.kind)).toEqual(["recording", "broadcast", "room"]);
  });

  // @ac 055/AC-003
  it("leaves a post without an embed exactly as it was, everywhere the API answers it", async () => {
    const h = await load();
    const me = await h.token(4242, { name: "Plain Poster" });
    const created = await h.call("POST", "/api/v1/posts", { token: me, body: { body: "Just words" } });
    const p = created.json as Post & { author: { id: string } };
    const timeline = (await h.call("GET", "/api/v1/timeline", { token: me })).json as { posts: Post[] };
    const page = (await h.call("GET", `/api/v1/posts/${p.id}`, { token: me })).json as { post: Post };
    const profile = (await h.call("GET", `/api/v1/profiles/${p.author.id}`, { token: me })).json as { posts: Post[] };
    expect([Object.keys(p), Object.keys(timeline.posts[0]!), Object.keys(page.post), Object.keys(profile.posts[0]!)]).toEqual([
      POST_KEYS,
      POST_KEYS,
      POST_KEYS,
      POST_KEYS,
    ]);
    const embedded = await h.call("POST", "/api/v1/posts", {
      token: me,
      body: { body: "With a card", embed: { kind: "room", id: MISSING } },
    });
    expect(embedded.status).toBe(404);
  });
});
