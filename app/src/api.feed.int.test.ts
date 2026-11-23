// Acceptance tests for spec 015's API: the feed (L2, real Postgres, the real relay in workerd). Each test first asserts its
// route is served, so on a base without the feature it fails on that assertion.
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type Room = { id: string; title: string };
type Feed = {
  live: {
    id: string;
    title: string;
    ref: string | null;
    heRef: string | null;
    sourceTitle: string | null;
    participants: number;
  }[];
  scheduled: { id: string; title: string; ref: string | null; roomId: string | null; scheduledAt: string }[];
  recent: { id: string; title: string; updatedAt: string }[];
};

async function withRelay() {
  const support = await import("@sefaria-social/relay/test-support");
  const relay = await support.startRelay();
  process.env.RELAY_INTERNAL_URL = relay.url.href;
  process.env.RELAY_INTERNAL_SECRET = support.SECRET;
  const protocols = async (sub: string) => ["sefaria-social.v1", `bearer.${await relay.token({ sub })}`];
  return { support, relay, protocols };
}
function withoutRelay() {
  delete process.env.RELAY_INTERNAL_URL;
  delete process.env.RELAY_INTERNAL_SECRET;
}

describe("spec 015: GET /api/v1/feed", () => {
  // @feature FEED-015 Feed API: live, scheduled and recent for the viewer
  // @ac 015/AC-001
  it("puts the viewer's live rooms (with ref, heRef, source title and count), upcoming shiurim and other rooms in their sections", async () => {
    expect(served("GET", "/api/v1/feed"), "GET /api/v1/feed is served").toBeTypeOf("function");
    const { support, relay, protocols } = await withRelay();
    try {
      const h = await load();
      const viewer = await h.token(4242);
      const other = await h.token(5151);
      const create = async (token: string, title: string) =>
        (await h.call("POST", "/api/v1/rooms", { token, body: { title } })).json as Room;
      const live = await create(viewer, "Bereshit together");
      const quiet = await create(viewer, "Mishnah circle");
      await h.sql("update rooms set updated_at = now() - interval '1 hour' where id = $1", [quiet.id]);
      const theirs = await create(other, "Their room");

      // Someone is in "Bereshit together", reading Genesis 1, and their summary carries the Hebrew ref.
      const peer = await support.connect(relay.mf, `/r/${live.id}`, { protocols: await protocols("5151") });
      peer.send(support.join("5151"));
      const slices = { "social.summary": { v: 1, value: { ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis" } } };
      peer.send({
        ch: "state",
        body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", nav: null, slices } },
      });

      const shiur = (title: string, roomId: string | null, visibility: string, when: string, teacher = 6161) =>
        h.sql(
          `insert into shiurim (room_id, teacher_user_id, title, ref, visibility, scheduled_at)
           values ($1, $2, $3, 'Berakhot 2a', $4, now() + $5::interval) returning id`,
          [roomId, teacher, title, visibility, when],
        );
      const [tomorrow] = await shiur("Public tomorrow", null, "public", "1 day");
      const [mine] = await shiur("In my room next week", quiet.id, "private", "7 days");
      const [taught] = await shiur("I teach it", null, "private", "2 days", 4242);
      await shiur("My room, yesterday", quiet.id, "private", "-1 day");
      await shiur("Their private one", theirs.id, "private", "1 day");

      await expect
        .poll(async () => ((await h.call("GET", "/api/v1/feed", { token: viewer })).json as Feed).live.map((r) => r.id))
        .toEqual([live.id]);
      const res = await h.call("GET", "/api/v1/feed", { token: viewer });
      const feed = res.json as Feed;
      expect(res.status).toBe(200);
      expect(feed.live).toEqual([
        {
          id: live.id,
          title: "Bereshit together",
          ref: "Genesis 1",
          heRef: "בראשית א׳",
          sourceTitle: "Genesis",
          participants: 1,
        },
      ]);
      expect(feed.recent.map((r) => [r.id, r.title])).toEqual([[quiet.id, "Mishnah circle"]]);
      expect(feed.scheduled.map((s) => [s.id, s.title, s.ref])).toEqual([
        [tomorrow!.id, "Public tomorrow", "Berakhot 2a"],
        [taught!.id, "I teach it", "Berakhot 2a"],
        [mine!.id, "In my room next week", "Berakhot 2a"],
      ]);
    } finally {
      withoutRelay();
      await relay.close().catch(() => undefined);
    }
  }, 60_000);

  // @feature FEED-015 Feed API: live, scheduled and recent for the viewer
  // @ac 015/AC-002
  it("answers 200 with everything recent when the relay is down, 401 without a token, and never shows other people's rooms", async () => {
    expect(served("GET", "/api/v1/feed"), "GET /api/v1/feed is served").toBeTypeOf("function");
    process.env.RELAY_INTERNAL_URL = "http://127.0.0.1:9"; // nothing listens there
    process.env.RELAY_INTERNAL_SECRET = "relay-secret";
    try {
      const h = await load();
      const viewer = await h.token(4242);
      const other = await h.token(5151);
      const a = (await h.call("POST", "/api/v1/rooms", { token: viewer, body: { title: "A" } })).json as Room;
      const b = (await h.call("POST", "/api/v1/rooms", { token: viewer, body: { title: "B" } })).json as Room;
      await h.sql("update rooms set updated_at = now() - interval '1 hour' where id = $1", [a.id]);
      const theirs = (await h.call("POST", "/api/v1/rooms", { token: other, body: { title: "Theirs" } })).json as Room;
      await h.sql(
        `insert into shiurim (room_id, teacher_user_id, title, visibility, scheduled_at) values ($1, 5151, 'Private', 'private', now() + interval '1 day')`,
        [theirs.id],
      );

      const res = await h.call("GET", "/api/v1/feed", { token: viewer });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        live: [],
        scheduled: [],
        recent: [
          { id: b.id, title: "B", updatedAt: expect.any(String) },
          { id: a.id, title: "A", updatedAt: expect.any(String) },
        ],
      });
      const anonymous = await h.call("GET", "/api/v1/feed");
      expect([anonymous.status, (anonymous.json as { error: { code: string } }).error.code]).toEqual([401, "auth.missing_token"]);
    } finally {
      withoutRelay();
    }
  }, 30_000);
});
