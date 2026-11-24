// Acceptance tests for spec 039: a room's owner mutes a participant or removes them from the call (L2, real Postgres), through
// the route tree, with a local server playing LiveKit's RoomService (Twirp). Each test first asserts its route is served, so on
// a base without the feature it fails on that assertion.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const MUTE = "/api/v1/rooms/$roomId/call/mute";
const REMOVE = "/api/v1/rooms/$roomId/call/remove";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Room = { id: string };
const OWNER = 910001;
const DANA = 910002;
const NOA = 910003;

/** LiveKit's RoomService for one call: who is in it with which tracks; records every call. */
async function fakeLivekit(inCall: Record<string, { sid: string; source: string }[]>) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const method = req.url?.split("/").pop() ?? "";
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      calls.push({ method, body });
      const who = inCall[String(body.identity)];
      const json = (status: number, v: unknown) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
      if (!who) return json(404, { code: "not_found", msg: "participant not found" });
      if (method === "GetParticipant") return json(200, { identity: body.identity, tracks: who });
      if (method === "MutePublishedTrack") return json(200, { track: { sid: body.trackSid, muted: true } });
      if (method === "RemoveParticipant") return json(200, {});
      return json(404, { code: "bad_route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function setup() {
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const lk = await fakeLivekit({
    [`u:${DANA}`]: [
      { sid: "TR_mic", source: "MICROPHONE" },
      { sid: "TR_cam", source: "CAMERA" },
      { sid: "TR_scr", source: "SCREEN_SHARE" },
    ],
  });
  process.env.LIVEKIT_URL = lk.url;
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  const owner = await h.token(OWNER, { name: "Avi Owner" });
  const dana = await h.token(DANA, { name: "Dana" });
  const noa = await h.token(NOA, { name: "Noa" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Moderated" } })).json as Room;
  await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: dana });
  return { h, lk, owner, dana, noa, room, resetConfig };
}

describe("spec 039: removals and account deletion", () => {
  // @feature API-048 Owner mutes or removes a call participant
  // @ac 039/AC-003
  it("deletes a user's call removals with their account", async () => {
    expect(served("POST", REMOVE), `POST ${REMOVE} is served`).toBeTypeOf("function");
    const { h, lk, owner, room } = await setup();
    try {
      const removed = await h.call("POST", `/api/v1/rooms/${room.id}/call/remove`, {
        token: owner,
        body: { participant: `u:${DANA}` },
      });
      expect(removed.status).toBe(204);
      expect(await h.sql("select user_id from call_removals")).toEqual([{ user_id: String(DANA) }]);
      const body = JSON.stringify({
        event: "user.deleted",
        id: "evt-removed",
        occurred_at: "2026-11-24T01:02:03Z",
        user_id: DANA,
      });
      expect((await h.webhook(body)).status).toBe(200);
      expect(await h.sql("select user_id from call_removals")).toEqual([]);
    } finally {
      await lk.close();
    }
  });
});

describe("spec 039: call moderation", () => {
  // @feature API-048 Owner mutes or removes a call participant
  // @ac 039/AC-001
  it("lets the owner mute a participant's microphone, camera or screen share", async () => {
    expect(served("POST", MUTE), `POST ${MUTE} is served`).toBeTypeOf("function");
    const { h, lk, owner, room } = await setup();
    try {
      for (const [source, sid] of [
        ["microphone", "TR_mic"],
        ["camera", "TR_cam"],
        ["screen_share", "TR_scr"],
      ] as const) {
        const res = await h.call("POST", `/api/v1/rooms/${room.id}/call/mute`, {
          token: owner,
          body: { participant: `u:${DANA}`, source },
        });
        expect(res.status, source).toBe(204);
        expect(lk.calls.filter((c) => c.method === "MutePublishedTrack").at(-1)?.body).toMatchObject({
          room: `room_${room.id}`,
          identity: `u:${DANA}`,
          trackSid: sid,
          muted: true,
        });
      }
    } finally {
      await lk.close();
    }
  });

  // @feature API-048 Owner mutes or removes a call participant
  // @ac 039/AC-002
  // @ac 039/AC-003
  it("lets the owner remove a participant from the call, keeps them in the room, and refuses their tokens for 15 minutes", async () => {
    expect(served("POST", REMOVE), `POST ${REMOVE} is served`).toBeTypeOf("function");
    const { h, lk, owner, dana, room } = await setup();
    try {
      const res = await h.call("POST", `/api/v1/rooms/${room.id}/call/remove`, {
        token: owner,
        body: { participant: `u:${DANA}` },
      });
      expect(res.status).toBe(204);
      expect(lk.calls.filter((c) => c.method === "RemoveParticipant").map((c) => c.body)).toEqual([
        { room: `room_${room.id}`, identity: `u:${DANA}` },
      ]);
      expect((await h.call("GET", `/api/v1/rooms/${room.id}`, { token: dana })).status, "still a member").toBe(200);
      const refused = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: dana });
      expect([refused.status, (refused.json as { error: { code: string } }).error.code]).toEqual([403, "call.removed"]);
      const [row] = await h.sql<{ minutes: number }>(
        "select round(extract(epoch from (until - now())) / 60)::int as minutes from call_removals where user_id = $1",
        [DANA],
      );
      expect(row?.minutes).toBe(15);
      await h.sql("update call_removals set until = now() - interval '1 second'");
      expect((await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: dana })).status, "after 15 minutes").toBe(200);
    } finally {
      await lk.close();
    }
  });

  // @feature API-048 Owner mutes or removes a call participant
  // @ac 039/AC-004
  it("answers a member who is not the owner 403, an outsider 404, and everyone 503 when calls are off", async () => {
    expect(served("POST", MUTE), `POST ${MUTE} is served`).toBeTypeOf("function");
    const { h, lk, dana, noa, owner, room, resetConfig } = await setup();
    try {
      const body = { participant: `u:${OWNER}`, source: "microphone" };
      const asDana = await h.call("POST", `/api/v1/rooms/${room.id}/call/mute`, { token: dana, body });
      const asNoa = await h.call("POST", `/api/v1/rooms/${room.id}/call/mute`, { token: noa, body });
      const removeAsDana = await h.call("POST", `/api/v1/rooms/${room.id}/call/remove`, {
        token: dana,
        body: { participant: `u:${OWNER}` },
      });
      expect([asDana.status, asNoa.status, removeAsDana.status]).toEqual([403, 404, 403]);
      expect(lk.calls).toEqual([]);
      process.env.CALLS_ENABLED = "false";
      resetConfig();
      const off = await h.call("POST", `/api/v1/rooms/${room.id}/call/mute`, {
        token: owner,
        body: { participant: `u:${DANA}`, source: "camera" },
      });
      expect([off.status, (off.json as { error: { code: string } }).error.code]).toEqual([503, "call.unavailable"]);
    } finally {
      process.env.CALLS_ENABLED = "true";
      resetConfig();
      await lk.close();
    }
  });

  // @feature API-048 Owner mutes or removes a call participant
  // @ac 039/AC-005
  it("answers 404 for someone not in the call or not an identity, and calls nothing for a malformed one", async () => {
    expect(served("POST", MUTE), `POST ${MUTE} is served`).toBeTypeOf("function");
    const { h, lk, owner, room } = await setup();
    try {
      const notInCall = await h.call("POST", `/api/v1/rooms/${room.id}/call/mute`, {
        token: owner,
        body: { participant: "u:999", source: "microphone" },
      });
      expect([notInCall.status, (notInCall.json as { error: { code: string } }).error.code]).toEqual([
        404,
        "call.participant_not_found",
      ]);
      expect(lk.calls.filter((c) => c.method === "MutePublishedTrack")).toEqual([]);
      const before = lk.calls.length;
      for (const participant of ["dana", "u:", "u:0", "u:12a"]) {
        const r = await h.call("POST", `/api/v1/rooms/${room.id}/call/remove`, { token: owner, body: { participant } });
        expect(r.status, participant).toBe(404);
      }
      expect(lk.calls.length, "nothing sent to LiveKit").toBe(before);
    } finally {
      await lk.close();
    }
  });
});
