// Acceptance tests for spec 033: a room member gets a LiveKit token for the room's call (L2, real Postgres), through the
// route tree. Each test first asserts its route is served, so on a base without the feature it fails on that assertion.
// The LiveKit token is checked by verifying it with the test API secret, the way LiveKit itself does.
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const PATH = "/api/v1/rooms/$roomId/call/token";

/** The handler for `method` on the route whose path is exactly `path` (a parent route's fuzzy match does not count). */
function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

const load = async () => {
  const mod = await import("../../test/integration/harness");
  return { h: await mod.harness(getRouter()), livekit: mod.LIVEKIT_TEST };
};
type Room = { id: string };
type CallToken = { url: string; token: string; expiresAt: string };
type VideoGrant = {
  roomJoin?: boolean;
  room?: string;
  canSubscribe?: boolean;
  canPublish?: boolean;
  canPublishSources?: string[];
  canPublishData?: boolean;
};
type LiveKitClaims = {
  sub?: string;
  iss?: string;
  name?: string;
  metadata?: string;
  video?: VideoGrant;
  exp?: number;
  nbf?: number;
};
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

async function decode(token: string, secret: string): Promise<LiveKitClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
  return payload as LiveKitClaims;
}

describe("spec 033: call tokens", () => {
  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-001
  it("issues a member and the owner a 10-minute token for this room, naming them and their role", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h, livekit } = await load();
    const owner = await h.token(5151, { name: "Avi Owner" });
    const member = await h.token(4242, { name: "Dana Member" });
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Daf Yomi" } })).json as Room;
    await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: member });

    const before = Math.floor(Date.now() / 1000);
    const res = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: member });
    expect(res.status).toBe(200);
    const body = res.json as CallToken;
    expect(body.url).toBe(livekit.url);
    const claims = await decode(body.token, livekit.secret);
    expect(claims.iss).toBe(livekit.key);
    expect(claims.sub).toBe("u:4242");
    expect(claims.name).toBe("Dana Member");
    expect(claims.video?.room).toBe(`room_${room.id}`);
    expect(JSON.parse(claims.metadata ?? "null")).toEqual({ v: 1, role: "member" });
    expect(claims.exp! - before).toBeGreaterThanOrEqual(600 - 2);
    expect(claims.exp! - before).toBeLessThanOrEqual(600 + 2);
    expect(Math.floor(Date.parse(body.expiresAt) / 1000)).toBe(claims.exp);

    const own = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: owner });
    expect(own.status).toBe(200);
    const ownClaims = await decode((own.json as CallToken).token, livekit.secret);
    expect([ownClaims.sub, ownClaims.name]).toEqual(["u:5151", "Avi Owner"]);
    expect(JSON.parse(ownClaims.metadata ?? "null")).toEqual({ v: 1, role: "owner" });
  });

  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-002
  it("grants joining this room only, subscribing, publishing microphone, camera and screen share, and no data", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h, livekit } = await load();
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Mishnah" } })).json as Room;
    const res = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: owner });
    expect(res.status).toBe(200);
    const { video } = await decode((res.json as CallToken).token, livekit.secret);
    expect(video).toMatchObject({
      roomJoin: true,
      room: `room_${room.id}`,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
    });
    expect([...(video?.canPublishSources ?? [])].sort()).toEqual(["camera", "microphone", "screen_share"]);
    // nothing beyond joining: no admin, recording or room-creation powers
    for (const power of ["roomAdmin", "roomCreate", "roomList", "roomRecord", "ingressAdmin", "hidden", "recorder"])
      expect(video, power).not.toHaveProperty(power, true);
  });

  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-003
  it("answers a non-member and a missing room with the same 404 and no token", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h } = await load();
    const owner = await h.token(5151);
    const stranger = await h.token(6161);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Private" } })).json as Room;

    const notMember = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: stranger });
    const missing = await h.call("POST", `/api/v1/rooms/${MISSING}/call/token`, { token: stranger });
    expect([notMember.status, missing.status]).toEqual([404, 404]);
    expect(notMember.json).toEqual({ error: { code: "room.not_found", message: "Room not found." } });
    expect(missing.json).toEqual(notMember.json);
  });

  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-004
  it("answers 401 without a valid Sefaria token", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h } = await load();
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Gemara" } })).json as Room;
    const none = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`);
    const expired = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, {
      token: await h.token(5151, {}, { expiresIn: "-1m" }),
    });
    const wrongAudience = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, {
      token: await h.token(5151, {}, { audience: "someone-else" }),
    });
    expect([none.status, expired.status, wrongAudience.status]).toEqual([401, 401, 401]);
    for (const r of [none, expired, wrongAudience]) expect(JSON.stringify(r.json)).not.toContain('"token"');
  });
});

describe("spec 033: the calls switch", () => {
  // @feature SESS-056 Calls switch and the room's calls field
  // @ac 033/AC-005
  it("says calls are unavailable, and refuses tokens with 503, unless switched on and fully configured", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h } = await load();
    const { resetConfig } = await import("~/server/config");
    const owner = await h.token(5151);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Calls" } })).json as Room;

    const on = await h.call("GET", `/api/v1/rooms/${room.id}`, { token: owner });
    expect((on.json as { calls?: unknown }).calls).toEqual({ available: true });

    const saved = { ...process.env };
    try {
      for (const off of [
        { CALLS_ENABLED: undefined },
        { CALLS_ENABLED: "yes" },
        { LIVEKIT_URL: undefined },
        { LIVEKIT_API_KEY: undefined },
        { LIVEKIT_API_SECRET: undefined },
      ]) {
        Object.assign(process.env, saved);
        for (const [k, v] of Object.entries(off))
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        resetConfig();
        const label = JSON.stringify(off);
        const token = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: owner });
        expect([token.status, (token.json as { error?: { code?: string } }).error?.code], label).toEqual([
          503,
          "call.unavailable",
        ]);
        const read = await h.call("GET", `/api/v1/rooms/${room.id}`, { token: owner });
        expect([read.status, (read.json as { calls?: unknown }).calls], label).toEqual([200, { available: false }]);
        const list = await h.call("GET", "/api/v1/rooms", { token: owner });
        expect(
          (list.json as { rooms: { calls?: unknown }[] }).rooms.map((r) => r.calls),
          label,
        ).toEqual([{ available: false }]);
      }
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetConfig();
    }
  });
});

describe("spec 033: abuse and secrets", () => {
  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-006
  it("refuses a 21st token request for the same room within a minute with 429 and retry-after, for that user and room only", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h } = await load();
    const owner = await h.token(7171);
    const other = await h.token(7272);
    const a = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "A" } })).json as Room;
    const b = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "B" } })).json as Room;
    await h.call("POST", `/api/v1/rooms/${a.id}/members`, { token: other });

    const statuses: number[] = [];
    for (let i = 0; i < 20; i++)
      statuses.push((await h.call("POST", `/api/v1/rooms/${a.id}/call/token`, { token: owner })).status);
    expect(statuses).toEqual(Array(20).fill(200));
    const limited = await h.call("POST", `/api/v1/rooms/${a.id}/call/token`, { token: owner });
    expect(limited.status).toBe(429);
    expect((limited.json as { error?: { code?: string } }).error?.code).toBe("request.rate_limited");
    const retry = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retry) && retry >= 1 && retry <= 60, `retry-after ${limited.headers.get("retry-after")}`).toBe(true);
    expect(JSON.stringify(limited.json)).not.toContain('"token"');
    // another room for the same user, and the same room for another user, are not limited
    expect((await h.call("POST", `/api/v1/rooms/${b.id}/call/token`, { token: owner })).status).toBe(200);
    expect((await h.call("POST", `/api/v1/rooms/${a.id}/call/token`, { token: other })).status).toBe(200);
  });

  // @feature API-046 Call token endpoint for room members
  // @ac 033/AC-007
  it("logs each token request without the LiveKit token, key or secret, or the caller's Sefaria token", async () => {
    expect(served("POST", PATH), `POST ${PATH} is served`).toBeTypeOf("function");
    const { h, livekit } = await load();
    const owner = await h.token(8181);
    const stranger = await h.token(8282);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Logs" } })).json as Room;
    h.logs.length = 0;

    const ok = await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: owner });
    const issued = (ok.json as CallToken).token;
    expect(issued.split(".")).toHaveLength(3); // a real token was issued, so its absence below means something
    await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: stranger }); // 404
    await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: "not-a-jwt" }); // 401
    const { resetConfig } = await import("~/server/config");
    const saved = process.env.CALLS_ENABLED;
    delete process.env.CALLS_ENABLED;
    resetConfig();
    try {
      expect((await h.call("POST", `/api/v1/rooms/${room.id}/call/token`, { token: owner })).status).toBe(503);
    } finally {
      process.env.CALLS_ENABLED = saved;
      resetConfig();
    }

    const lines = h.logs.filter((l) => l.includes("/call/token"));
    expect(lines.map((l) => (JSON.parse(l) as { status?: number }).status)).toEqual([200, 404, 401, 503]);
    const all = h.logs.join("\n");
    for (const secret of [issued, issued.split(".")[2]!, livekit.key, livekit.secret, owner, stranger, "not-a-jwt", "Bearer"])
      expect(all.includes(secret), `the log contains ${secret.slice(0, 12)}…`).toBe(false);
  });
});
