// Acceptance tests for spec 043, server side: a room's owner starts and ends a broadcast; anyone signed in gets a relay ticket
// naming their role, and a LiveKit token for the broadcast's call, view only unless they host it (L2, real Postgres), through
// the route tree. Tickets are checked with Node's own HMAC, LiveKit tokens by verifying them with the test API secret. Each test
// first asserts its route is served, so on a base without the feature it fails on that assertion.
import { createHmac } from "node:crypto";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const START = "/api/v1/rooms/$roomId/broadcasts";
const TICKET = "/api/v1/broadcasts/$broadcastId/ticket";
const CALL_TOKEN = "/api/v1/broadcasts/$broadcastId/call/token";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Room = { id: string };
type Broadcast = { id: string; roomId: string; title: string; hostName: string | null; status: string; link: string };
type Ticket = { ticket: string; role: string; relayRoom: string; expiresAt: string };
type CallToken = { url: string; token: string; expiresAt: string };
type ErrorJson = { error: { code: string } };
type Claims = {
  sub?: string;
  metadata?: string;
  video?: {
    roomJoin?: boolean;
    room?: string;
    canSubscribe?: boolean;
    canPublish?: boolean;
    canPublishSources?: string[];
    canPublishData?: boolean;
    hidden?: boolean;
  };
};

const HOST = 930001;
const DANA = 930002;
const VIEWER = 930003;
const RELAY_SECRET = "integration-test-relay-secret";
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const mod = await import("../../test/integration/harness");
  const h = await mod.harness(getRouter());
  process.env.RELAY_INTERNAL_SECRET = RELAY_SECRET;
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = () => {
    delete process.env.RELAY_INTERNAL_SECRET;
    process.env.CALLS_ENABLED = "true";
    resetConfig();
  };
  const host = await h.token(HOST, { name: "Avi Host" });
  const dana = await h.token(DANA, { name: "Dana" });
  const viewer = await h.token(VIEWER, { name: "Viewer" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: host, body: { title: "Daf broadcast" } })).json as Room;
  await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: dana });
  const start = (token = host, roomId = room.id) => h.call("POST", `/api/v1/rooms/${roomId}/broadcasts`, { token });
  return { h, livekit: mod.LIVEKIT_TEST, host, dana, viewer, room, start, resetConfig };
}

describe("spec 043: broadcasts on the server", () => {
  // @feature API-050 Broadcasts API: start, end, relay tickets and view-only call grants
  // @ac 043/AC-001
  it("lets the room's owner start one live broadcast with a link, and its host end it", async () => {
    expect(served("POST", START), `POST ${START} is served`).toBeTypeOf("function");
    const { h, host, dana, viewer, room, start } = await setup();
    expect(code(await start(dana)), "a member who is not the owner").toBe("403 room.forbidden");
    expect(code(await start(viewer)), "a non-member").toBe("404 room.not_found");

    const res = await start();
    expect(res.status).toBe(201);
    const b = res.json as Broadcast;
    expect(b).toMatchObject({ roomId: room.id, title: "Daf broadcast", hostName: "Avi Host", status: "live" });
    expect(b.link).toBe(`/social/b/${b.id}`);
    expect(code(await start()), "a second while one is live").toBe("409 broadcast.already_live");
    const roomRead = async () => (await h.call("GET", `/api/v1/rooms/${room.id}`, { token: host })).json as { broadcast?: unknown };
    expect((await roomRead()).broadcast, "the room names its live broadcast (a reloaded host finds it)").toEqual({
      id: b.id,
      link: b.link,
    });

    const seen = await h.call("GET", `/api/v1/broadcasts/${b.id}`, { token: viewer });
    expect(seen.status, "anyone signed in with the link reads it").toBe(200);
    expect(seen.json).toEqual(b);
    expect(code(await h.call("GET", `/api/v1/broadcasts/${MISSING}`, { token: viewer }))).toBe("404 broadcast.not_found");

    const end = (token: string) => h.call("POST", `/api/v1/broadcasts/${b.id}/end`, { token });
    expect(code(await end(viewer)), "not the host").toBe("403 broadcast.forbidden");
    expect(code(await end(dana)), "a member, not the host").toBe("403 broadcast.forbidden");
    const ended = await end(host);
    expect(ended.status).toBe(200);
    expect(ended.json).toMatchObject({ id: b.id, status: "ended" });
    expect((await roomRead()).broadcast, "and not after it ends").toBeUndefined();
    expect(await h.sql("select status, ended_at is not null as ended from broadcasts")).toEqual([
      { status: "ended", ended: true },
    ]);
    expect((await start()).status, "a new one after the last ended").toBe(201);
  });

  // @feature API-050 Broadcasts API: start, end, relay tickets and view-only call grants
  // @ac 043/AC-002
  it("signs a 10-minute relay ticket naming the broadcast, the user and their role, and refuses ended or unknown ones", async () => {
    expect(served("POST", TICKET), `POST ${TICKET} is served`).toBeTypeOf("function");
    const { h, host, viewer, start, resetConfig } = await setup();
    const b = (await start()).json as Broadcast;
    const ticket = (token: string, id = b.id) => h.call("POST", `/api/v1/broadcasts/${id}/ticket`, { token });

    for (const [token, userId, role] of [
      [host, HOST, "host"],
      [viewer, VIEWER, "viewer"],
    ] as const) {
      const before = Math.floor(Date.now() / 1000);
      const res = await ticket(token);
      const after = Math.floor(Date.now() / 1000);
      expect(res.status, role).toBe(200);
      const t = res.json as Ticket;
      expect(t.role).toBe(role);
      expect(t.relayRoom).toBe(`b_${b.id}`);
      const [body, sig] = t.ticket.split(".") as [string, string];
      expect(t.ticket.split(".")).toHaveLength(2);
      expect(sig, "signed with the relay secret over the first segment").toBe(
        createHmac("sha256", RELAY_SECRET).update(body, "ascii").digest("base64url"),
      );
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
      expect(Object.keys(claims)).toEqual(["b", "sub", "role", "exp"]);
      expect(claims).toMatchObject({ b: b.id, sub: String(userId), role });
      expect(claims.exp).toBeGreaterThanOrEqual(before + 600);
      expect(claims.exp).toBeLessThanOrEqual(after + 600);
      expect(t.expiresAt).toBe(new Date((claims.exp as number) * 1000).toISOString());
    }

    expect(code(await ticket(viewer, MISSING)), "unknown").toBe("404 broadcast.not_found");
    await h.call("POST", `/api/v1/broadcasts/${b.id}/end`, { token: host });
    expect(code(await ticket(viewer)), "ended").toBe("404 broadcast.not_found");
    expect(code(await ticket(host)), "ended, even for its host").toBe("404 broadcast.not_found");

    const next = (await start()).json as Broadcast;
    delete process.env.RELAY_INTERNAL_SECRET;
    resetConfig();
    expect(code(await ticket(viewer, next.id)), "no relay secret").toBe("503 broadcast.unavailable");
  });

  // @feature API-050 Broadcasts API: start, end, relay tickets and view-only call grants
  // @ac 043/AC-005
  it("grants the host publishing as a call owner and a viewer a hidden, subscribe-only token for the broadcast's call", async () => {
    expect(served("POST", CALL_TOKEN), `POST ${CALL_TOKEN} is served`).toBeTypeOf("function");
    const { h, livekit, host, viewer, start, resetConfig } = await setup();
    const b = (await start()).json as Broadcast;
    const token = async (t: string, id = b.id) => h.call("POST", `/api/v1/broadcasts/${id}/call/token`, { token: t });
    const decode = async (jwt: string) =>
      (await jwtVerify(jwt, new TextEncoder().encode(livekit.secret), { algorithms: ["HS256"] })).payload as Claims;

    const hostRes = await token(host);
    expect(hostRes.status).toBe(200);
    expect((hostRes.json as CallToken).url).toBe(livekit.url);
    const hostClaims = await decode((hostRes.json as CallToken).token);
    expect(hostClaims.sub).toBe(`u:${HOST}`);
    expect(JSON.parse(hostClaims.metadata ?? "null")).toEqual({ v: 1, role: "host" });
    expect(hostClaims.video).toEqual({
      roomJoin: true,
      room: `bcast_${b.id}`,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: ["microphone", "camera", "screen_share"],
      canPublishData: false,
    });

    const viewerRes = await token(viewer);
    expect(viewerRes.status).toBe(200);
    const viewerClaims = await decode((viewerRes.json as CallToken).token);
    expect(viewerClaims.sub).toBe(`u:${VIEWER}`);
    expect(JSON.parse(viewerClaims.metadata ?? "null")).toEqual({ v: 1, role: "viewer" });
    expect(viewerClaims.video).toEqual({
      roomJoin: true,
      room: `bcast_${b.id}`,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      hidden: true,
    });

    expect(code(await token(viewer, MISSING)), "unknown").toBe("404 broadcast.not_found");
    process.env.CALLS_ENABLED = "false";
    resetConfig();
    expect(code(await token(viewer)), "calls off").toBe("503 call.unavailable");
    process.env.CALLS_ENABLED = "true";
    resetConfig();
    await h.call("POST", `/api/v1/broadcasts/${b.id}/end`, { token: host });
    expect(code(await token(viewer)), "ended").toBe("404 broadcast.not_found");
  });
});
