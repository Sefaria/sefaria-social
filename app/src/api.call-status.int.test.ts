// Acceptance tests for spec 038: LiveKit webhooks into a call status per room, the status in the lobby and on cards, and a
// deleted account leaving every live call (L2, real Postgres), through the route tree. Each test first asserts its route is
// served, so on a base without the feature it fails on that assertion.
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const WEBHOOK = "/api/v1/internal/livekit/webhook";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type Room = { id: string };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

let seq = 0;
const event = (type: string, roomId: string, participants: number, id = `EV_${++seq}_${Math.random().toString(36).slice(2)}`) =>
  JSON.stringify({
    event: type,
    id,
    createdAt: String(Math.floor(Date.now() / 1000)),
    room: { sid: `RM_${roomId.slice(0, 8)}`, name: `room_${roomId}`, numParticipants: participants },
  });

/** A local server playing LiveKit's RoomService (Twirp): records RemoveParticipant calls; `failures` sets per-room answers. */
async function fakeLivekit(failures: Record<string, number[]> = {}) {
  const { createServer } = await import("node:http");
  const removed: { room: string; identity: string }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!req.url?.endsWith("/livekit.RoomService/RemoveParticipant")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as { room: string; identity: string };
      removed.push(body);
      const status = failures[body.room]?.shift() ?? 200;
      if (status === 200) res.writeHead(200, { "content-type": "application/json" }).end("{}");
      else if (status === 404)
        res.writeHead(404, { "content-type": "application/json" }).end('{"code":"not_found","msg":"participant not found"}');
      else res.writeHead(status, { "content-type": "application/json" }).end('{"code":"internal","msg":"boom"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}`, removed, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const DELETED = 900000011;
const OTHER = 900000012;
const userDeleted = (id: string, userId: number) =>
  JSON.stringify({ event: "user.deleted", id, occurred_at: "2026-11-24T01:02:03Z", user_id: userId });

describe("spec 038: a deleted account leaves every call", () => {
  // @feature API-047 LiveKit webhooks, call status, and deletion leaving calls
  // @ac 038/AC-005
  it("asks LiveKit to remove the user from every live call, retries a failure once, and still completes the deletion", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(OTHER);
    const mk = async (title: string) =>
      ((await h.call("POST", "/api/v1/rooms", { token: owner, body: { title } })).json as Room).id;
    const [r, s, flaky, broken, quiet] = [await mk("R"), await mk("S"), await mk("Flaky"), await mk("Broken"), await mk("Quiet")];
    for (const id of [r, s, flaky, broken]) await h.livekitWebhook(event("participant_joined", id, 2));
    await h.livekitWebhook(event("participant_joined", quiet, 1));
    await h.livekitWebhook(event("participant_left", quiet, 0));
    const lk = await fakeLivekit({ [`room_${s}`]: [404], [`room_${flaky}`]: [500], [`room_${broken}`]: [500, 500] });
    process.env.LIVEKIT_URL = lk.url;
    const { resetConfig } = await import("~/server/config");
    resetConfig();
    try {
      await h.token(DELETED, { name: "Leaving" });
      const res = await h.webhook(userDeleted("evt-leave-calls", DELETED));
      expect([res.status, res.json]).toEqual([200, { status: "processed" }]);
      const byRoom = (room: string) => lk.removed.filter((x) => x.room === `room_${room}`);
      expect(lk.removed.every((x) => x.identity === `u:${DELETED}`)).toBe(true);
      expect([byRoom(r).length, byRoom(s).length, byRoom(flaky).length, byRoom(broken).length, byRoom(quiet).length]).toEqual([
        1, 1, 2, 2, 0,
      ]);
      const failed = h.logs.filter((l) => l.includes("livekit.remove_failed"));
      expect(failed).toHaveLength(1);
      expect(failed[0]).not.toContain(String(DELETED));
      expect(await h.sql("select user_id from deleted_users where user_id = $1", [DELETED])).toEqual([
        { user_id: String(DELETED) },
      ]);
    } finally {
      await lk.close();
    }
  });

  // @feature API-047 LiveKit webhooks, call status, and deletion leaving calls
  // @ac 038/AC-006
  it("leaves no row for the deleted user in any table, call_status included", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const walk = await import("../../test/integration/schema-walk");
    const seeded = await walk.seedEveryTable(h.sql, DELETED, OTHER, 900000013);
    expect(seeded).toContain("call_status");
    expect(await walk.uncoveredTables(h.sql, seeded)).toEqual([]);
    expect((await h.sql("select count(*)::int as n from call_status")) as unknown).toEqual([{ n: 2 }]);
    await h.webhook(userDeleted("evt-walk", DELETED));
    expect(await walk.userValues(h.sql, DELETED)).toEqual(["deleted_users.user_id: 1"]);
  });
});

describe("spec 038: call status in the API", () => {
  // @feature ROOM-045 N on a call in the lobby and on cards
  // @ac 038/AC-004
  it("includes a room's live call in its status and in the feed, and no call field when none is live", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const calling = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Calling" } })).json as Room;
    const quiet = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Quiet" } })).json as Room;
    await h.livekitWebhook(event("participant_joined", calling.id, 3));
    const status = async (id: string) =>
      ((await h.call("GET", `/api/v1/rooms/${id}/status`, { token: owner })).json as { call?: unknown }).call;
    expect(await status(calling.id)).toEqual({ live: true, participants: 3 });
    expect(await status(quiet.id)).toBeUndefined();
    const feed = (await h.call("GET", "/api/v1/feed", { token: owner })).json as {
      live: { id: string; call?: unknown }[];
      recent: { id: string; call?: unknown }[];
    };
    const calls = Object.fromEntries([...feed.live, ...feed.recent].map((r) => [r.id, r.call]));
    expect(calls).toEqual({ [calling.id]: { live: true, participants: 3 }, [quiet.id]: undefined });
  });
});

describe("spec 038: LiveKit webhooks", () => {
  // @feature API-047 LiveKit webhooks, call status, and deletion leaving calls
  // @ac 038/AC-001
  it("refuses a webhook without a valid signature and changes nothing", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Signed" } })).json as Room;
    const body = event("participant_joined", room.id, 1);
    const attempts = [
      await h.livekitWebhook(body, { secret: null }),
      await h.livekitWebhook(body, { secret: "another-secret-another-secret-0000" }),
      await h.livekitWebhook(body, { bodyForHash: event("participant_joined", room.id, 9) }),
    ];
    expect(attempts.map((r) => `${r.status} ${(r.json as { error: { code: string } }).error.code}`)).toEqual(
      Array(3).fill("401 webhook.bad_signature"),
    );
    expect(await h.sql("select * from call_status")).toEqual([]);
    expect(await h.sql("select * from webhook_receipts")).toEqual([]);
    // and a correctly signed one is accepted
    expect((await h.livekitWebhook(body)).status).toBe(200);
  });

  // @feature API-047 LiveKit webhooks, call status, and deletion leaving calls
  // @ac 038/AC-002
  it("applies a repeated event once", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Once" } })).json as Room;
    const body = event("participant_joined", room.id, 1, "EV_repeat");
    const first = await h.livekitWebhook(body);
    const again = await h.livekitWebhook(body);
    expect([first.json, again.json]).toEqual([{ status: "processed" }, { status: "duplicate" }]);
    expect(await h.sql("select event_id from webhook_receipts")).toEqual([{ event_id: "EV_repeat" }]);
  });

  // @feature API-047 LiveKit webhooks, call status, and deletion leaving calls
  // @ac 038/AC-003
  it("keeps each room's call status from joins, leaves and the end of the call, and ignores unknown rooms", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Status" } })).json as Room;
    const status = async () =>
      (
        await h.sql<{ live: boolean; participants: number }>("select live, participants from call_status where room_id = $1", [
          room.id,
        ])
      )[0] ?? null;
    await h.livekitWebhook(event("participant_joined", room.id, 1));
    expect(await status()).toEqual({ live: true, participants: 1 });
    await h.livekitWebhook(event("participant_joined", room.id, 2));
    expect(await status()).toEqual({ live: true, participants: 2 });
    await h.livekitWebhook(event("participant_left", room.id, 1));
    expect(await status()).toEqual({ live: true, participants: 1 });
    await h.livekitWebhook(event("participant_left", room.id, 0));
    expect(await status()).toEqual({ live: false, participants: 0 });
    await h.livekitWebhook(event("participant_joined", room.id, 1));
    await h.livekitWebhook(event("room_finished", room.id, 1));
    expect(await status()).toEqual({ live: false, participants: 0 });
    const started = (await h.sql<{ started_at: unknown }>("select started_at from call_status where room_id = $1", [room.id]))[0];
    expect(started?.started_at).toBeNull();

    // unknown rooms and other names are acknowledged and change nothing
    for (const body of [
      event("participant_joined", MISSING, 3),
      JSON.stringify({ event: "participant_joined", id: "EV_shiur", room: { name: "shiur_x", numParticipants: 2 } }),
      JSON.stringify({ event: "track_published", id: "EV_track", room: { name: `room_${room.id}`, numParticipants: 5 } }),
    ]) {
      const r = await h.livekitWebhook(body);
      expect([r.status, r.json]).toEqual([200, { status: "ignored" }]);
    }
    expect(await h.sql("select count(*)::int as n from call_status")).toEqual([{ n: 1 }]);
    expect(await status()).toEqual({ live: false, participants: 0 });
  });
});
