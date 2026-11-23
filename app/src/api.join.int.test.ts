// Acceptance tests for spec 011: joining and leaving rooms, the status passthrough, deletion reaching the relay, and CORS
// (L2, real Postgres), through the route tree. Each test first asserts its route is served, so on a base without the
// feature it fails on that assertion.
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

/** The handler for `method` on the route whose path is exactly `path` (a parent route's fuzzy match does not count). */
function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

const relayClients = import.meta.glob<Record<string, unknown>>("./server/services/relay.ts");
const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type Room = { id: string; title: string; ownerUserId: number; role: string };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

describe("spec 011: joining", () => {
  // @feature ROOM-011 Join and leave a room from its link
  // @ac 011/AC-001
  it("joins with the room's id, idempotently; the owner keeps their role; a missing room is room.not_found", async () => {
    expect(served("POST", "/api/v1/rooms/$roomId/members"), "POST /api/v1/rooms/$roomId/members is served").toBeTypeOf(
      "function",
    );
    const h = await load();
    const owner = await h.token(5151);
    const guest = await h.token(4242, { name: "Guest Learner" });
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Daf Yomi" } })).json as Room;

    const first = await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: guest });
    const again = await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: guest });
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(first.json).toMatchObject({ id: room.id, title: "Daf Yomi", ownerUserId: 5151, role: "member" });
    expect(again.json).toEqual(first.json);
    expect(await h.sql("select user_id, role from room_members where room_id = $1 order by user_id", [room.id])).toEqual([
      { user_id: "4242", role: "member" },
      { user_id: "5151", role: "owner" },
    ]);
    expect(await h.sql("select name from user_display where user_id = 4242")).toEqual([{ name: "Guest Learner" }]);

    const byOwner = await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: owner });
    expect([byOwner.status, (byOwner.json as Room).role]).toEqual([200, "owner"]);
    const missing = await h.call("POST", `/api/v1/rooms/${MISSING}/members`, { token: guest });
    expect([missing.status, missing.json]).toEqual([404, { error: { code: "room.not_found", message: "Room not found." } }]);
    // A member can now read the room; listing shows it.
    expect((await h.call("GET", `/api/v1/rooms/${room.id}`, { token: guest })).status).toBe(200);
  });

  // @feature ROOM-011 Join and leave a room from its link
  // @ac 011/AC-002
  it("lets a member leave; the owner cannot; a non-member gets room.not_found", async () => {
    expect(served("DELETE", "/api/v1/rooms/$roomId/members/me"), "DELETE .../members/me is served").toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const guest = await h.token(4242);
    const stranger = await h.token(6161);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Mishnah" } })).json as Room;
    await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: guest });

    const left = await h.call("DELETE", `/api/v1/rooms/${room.id}/members/me`, { token: guest });
    const ownerTries = await h.call("DELETE", `/api/v1/rooms/${room.id}/members/me`, { token: owner });
    const strangerTries = await h.call("DELETE", `/api/v1/rooms/${room.id}/members/me`, { token: stranger });
    expect([left.status, ownerTries.status, strangerTries.status]).toEqual([204, 403, 404]);
    expect((ownerTries.json as { error: { code: string } }).error.code).toBe("room.owner_cannot_leave");
    expect((await h.call("GET", `/api/v1/rooms/${room.id}`, { token: guest })).status).toBe(404);
    expect(await h.sql("select user_id from room_members where room_id = $1", [room.id])).toEqual([{ user_id: "5151" }]);
  });
});

/** The real relay (packages/relay) in workerd, wired to the server through RELAY_INTERNAL_URL and the shared secret. */
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

describe("spec 011: status and CORS", () => {
  // @feature API-045 Room status passthrough and CORS for the reader's origins
  // @ac 011/AC-003
  it("reads a member's room status from the relay, falls back when the relay is down, and hides it from non-members", async () => {
    expect(served("GET", "/api/v1/rooms/$roomId/status"), "GET /api/v1/rooms/$roomId/status is served").toBeTypeOf("function");
    const { support, relay, protocols } = await withRelay();
    try {
      const h = await load(); // after the relay env is set: the harness resets the cached config
      const owner = await h.token(5151);
      const stranger = await h.token(6161);
      const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Bereshit" } })).json as Room;

      const leader = await support.connect(relay.mf, `/r/${room.id}`, { protocols: await protocols("5151") });
      leader.send(support.join("5151"));
      const slices = { "social.summary": { v: 1, value: { ref: "Genesis 1", title: "Genesis 1" } } };
      leader.send({
        ch: "state",
        body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", nav: null, slices } },
      });
      const statusOf = async (token: string) => h.call("GET", `/api/v1/rooms/${room.id}/status`, { token });
      await expect
        .poll(async () => (await statusOf(owner)).json)
        .toEqual({
          live: true,
          ref: "Genesis 1",
          heRef: null,
          title: "Genesis 1",
          participants: 1,
        });
      expect((await statusOf(stranger)).status).toBe(404);

      await relay.close();
      expect(await statusOf(owner)).toMatchObject({
        status: 200,
        json: { live: false, ref: null, heRef: null, title: null, participants: 0 },
      });
    } finally {
      withoutRelay();
      await relay.close().catch(() => undefined);
    }
  }, 60_000);

  // @feature API-045 Room status passthrough and CORS for the reader's origins
  // @ac 011/AC-005
  it("answers preflights and adds CORS headers only for the configured origins", async () => {
    expect(served("GET", "/api/v1/rooms/$roomId/status"), "GET /api/v1/rooms/$roomId/status is served").toBeTypeOf("function");
    process.env.SOCIAL_ALLOWED_ORIGINS = "https://www.sefaria.org, https://www.sefaria.org.il";
    try {
      const h = await load();
      const token = await h.token(4242);
      const pre = (origin: string) =>
        h.call("OPTIONS", "/api/v1/rooms", {
          headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
        });
      const ok = await pre("https://www.sefaria.org");
      const evil = await pre("https://evil.example");
      expect({ status: ok.status, origin: ok.headers.get("access-control-allow-origin") }).toEqual({
        status: 204,
        origin: "https://www.sefaria.org",
      });
      expect(ok.headers.get("access-control-allow-methods")).toBe("GET, POST");
      expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
      expect({ status: evil.status, origin: evil.headers.get("access-control-allow-origin") }).toEqual({
        status: 204,
        origin: null,
      });

      const listed = await h.call("GET", "/api/v1/rooms", { token, headers: { origin: "https://www.sefaria.org.il" } });
      const refused = await h.call("GET", "/api/v1/rooms", { headers: { origin: "https://www.sefaria.org.il" } });
      const foreign = await h.call("GET", "/api/v1/rooms", { token, headers: { origin: "https://evil.example" } });
      expect([listed.status, refused.status, foreign.status]).toEqual([200, 401, 200]);
      expect([listed, refused, foreign].map((r) => r.headers.get("access-control-allow-origin"))).toEqual([
        "https://www.sefaria.org.il",
        "https://www.sefaria.org.il",
        null,
      ]);
    } finally {
      delete process.env.SOCIAL_ALLOWED_ORIGINS;
    }
  });
});

describe("spec 011: deletion reaches the relay", () => {
  // @feature IDENT-049 Account deletion drops the user from the relay
  // @ac 011/AC-004
  it("after the deletion commits, the relay drops the user from their rooms; a relay failure is logged and the webhook still succeeds", async () => {
    const mod = await relayClients["./server/services/relay.ts"]?.();
    expect(Object.keys(mod ?? {}), "server/services/relay.ts exports dropUserFromRelay").toContain("dropUserFromRelay");
    const { support, relay, protocols } = await withRelay();
    try {
      const h = await load();
      const owner = await h.token(5151);
      const doomed = await h.token(4242);
      const roomA = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "A" } })).json as Room;
      const roomB = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "B" } })).json as Room;
      for (const r of [roomA, roomB]) await h.call("POST", `/api/v1/rooms/${r.id}/members`, { token: doomed });
      const peers = [
        await support.connect(relay.mf, `/r/${roomA.id}`, { protocols: await protocols("4242") }),
        await support.connect(relay.mf, `/r/${roomB.id}`, { protocols: await protocols("4242") }),
      ];
      peers.forEach((p) => p.send(support.join("4242")));
      await expect.poll(() => peers.map((p) => support.lastParticipants(p)?.length)).toEqual([1, 1]);

      const body = JSON.stringify({ event: "user.deleted", id: "evt-0001", occurred_at: "2026-11-23T01:02:03Z", user_id: 4242 });
      const res = await h.webhook(body);
      expect([res.status, res.json]).toEqual([200, { status: "processed" }]);
      await expect.poll(() => peers.map((p) => p.closed)).toEqual([true, true]);
      const back = await support.connect(relay.mf, `/r/${roomA.id}`, { protocols: await protocols("4242") });
      expect(back.status).toBe(401);

      // The relay down: the deletion still commits, the webhook answers processed, and the failure is logged.
      await relay.close();
      await h.call("POST", "/api/v1/rooms", { token: await h.token(6161), body: { title: "C" } });
      const body2 = JSON.stringify({ event: "user.deleted", id: "evt-0002", occurred_at: "2026-11-23T01:02:04Z", user_id: 6161 });
      const res2 = await h.webhook(body2);
      expect([res2.status, res2.json]).toEqual([200, { status: "processed" }]);
      expect(await h.sql("select count(*)::int as n from rooms where owner_user_id = 6161")).toEqual([{ n: 0 }]);
      expect(h.logs.filter((l) => JSON.parse(l).msg === "relay.drop_failed")).toHaveLength(1);
    } finally {
      withoutRelay();
      await relay.close().catch(() => undefined);
    }
  }, 60_000);
});
