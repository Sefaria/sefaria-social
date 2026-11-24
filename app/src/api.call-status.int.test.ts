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
