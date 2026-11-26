// Acceptance tests for spec 056 (live cards), L2: real Postgres through the route tree. The relay's signed reports are kept per
// room (AC-002) and the public read answers the live state of sessions that posts embed, and only those (AC-003).
// @feature API-051 Live status of posted sessions: relay reports and the public read
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const SECRET = "relay-live-test-secret";
const REPORT = "/api/v1/internal/relay/live";
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

async function load() {
  process.env.RELAY_INTERNAL_SECRET = SECRET;
  delete process.env.RELAY_INTERNAL_URL; // no relay to read: only reports count
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const live = await import("~/server/services/live").catch(() => null);
  live?.clearLiveCache();
  return { h, clear: () => live?.clearLiveCache() };
}
type H = Awaited<ReturnType<typeof load>>["h"];
type Status = {
  id: string;
  kind: string;
  live: boolean;
  ref: string | null;
  heRef: string | null;
  here: number;
  updatedAt: string | null;
};

const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

async function report(h: H, body: Record<string, unknown>, opts: { signature?: string | null } = {}) {
  const raw = JSON.stringify({ at: Date.now(), heRef: null, title: null, ...body });
  const signature = opts.signature === undefined ? sign(raw) : opts.signature;
  return h.call("POST", REPORT, {
    rawBody: raw,
    headers: signature === null ? {} : { "x-relay-signature": signature },
  });
}

async function setUp(h: H) {
  const owner = await h.token(4242, { name: "Rav Owner" });
  const mk = async (title: string) =>
    ((await h.call("POST", "/api/v1/rooms", { token: owner, body: { title } })).json as { id: string }).id;
  const room = await mk("Daf Yomi together");
  const quiet = await mk("Nobody posted this one");
  const other = await mk("Broadcast room");
  const broadcast = ((await h.call("POST", `/api/v1/rooms/${other}/broadcasts`, { token: owner })).json as { id: string }).id;
  const recording = (
    (await h.call("POST", `/api/v1/rooms/${room}/recordings`, { token: owner, body: {} })).json as { id: string }
  ).id;
  for (const [kind, id] of [
    ["room", room],
    ["broadcast", broadcast],
    ["recording", recording],
  ] as const)
    expect((await h.call("POST", "/api/v1/posts", { token: owner, body: { body: "", embed: { kind, id } } })).status).toBe(201);
  return { room, quiet, broadcast, recording };
}

const read = (h: H, ids: string[], headers: Record<string, string> = {}) =>
  h.call("GET", `/api/v1/live?ids=${ids.join(",")}`, { headers });

describe("spec 056: live status of posted sessions", () => {
  // @ac 056/AC-002
  it("keeps the newest signed report per room, refuses bad signatures and old timestamps, and ignores unknown rooms", async () => {
    expect(served("POST", REPORT), `POST ${REPORT} is served`).toBeTypeOf("function");
    const { h, clear } = await load();
    const s = await setUp(h);
    const at = Date.now();

    expect((await report(h, { room: s.room, ref: "Genesis 1:1", participants: 2 }, { signature: null })).status).toBe(401);
    expect((await report(h, { room: s.room, ref: "Genesis 1:1", participants: 2 }, { signature: sign("x") })).status).toBe(401);
    expect(
      (await report(h, { room: s.room, ref: "Genesis 1:1", participants: 2, at: at - 6 * 60_000 })).status,
      "a report 6 minutes old",
    ).toBe(401);
    expect(
      (await report(h, { room: s.room, ref: "Genesis 1:1", participants: 2, at: at + 60_000 })).status,
      "a report from a minute in the future",
    ).toBe(401);

    expect((await report(h, { room: s.room, ref: "Genesis 1:2", participants: 2, at })).status).toBe(204);
    expect((await report(h, { room: s.room, ref: "Genesis 1:1", participants: 2, at: at - 1_000 })).status).toBe(204); // older
    expect((await report(h, { room: `b_${s.broadcast}`, ref: "Exodus 3:1", participants: 5, at })).status).toBe(204);
    expect((await report(h, { room: MISSING, ref: "Genesis 9:9", participants: 1, at })).status).toBe(204);
    expect((await report(h, { room: `b_${MISSING}`, ref: "Genesis 9:9", participants: 1, at })).status).toBe(204);

    expect(await h.sql("select relay_room, ref, participants from live_status order by relay_room")).toEqual(
      [
        { relay_room: s.room, ref: "Genesis 1:2", participants: 2 },
        { relay_room: `b_${s.broadcast}`, ref: "Exodus 3:1", participants: 5 },
      ].sort((a, b) => (a.relay_room < b.relay_room ? -1 : 1)),
    );
    clear();
    const res = await read(h, [s.room]);
    expect((res.json as Status[]).map((x) => x.ref)).toEqual(["Genesis 1:2"]);
  });

  // @ac 056/AC-003
  it("answers anyone for 1–50 posted ids, live only when fresh, leaves the rest out, and answers 304 for an unchanged ETag", async () => {
    expect(served("GET", "/api/v1/live"), "GET /api/v1/live is served").toBeTypeOf("function");
    const { h, clear } = await load();
    const s = await setUp(h);
    await report(h, { room: s.room, ref: "Genesis 2:1", heRef: "בראשית ב:א", title: "Daf", participants: 3 });
    await report(h, { room: `b_${s.broadcast}`, ref: "Exodus 3:1", participants: 4 });
    const whileLive = (await read(h, [s.broadcast])).json as Status[];
    expect(whileLive.map((x) => [x.kind, x.live, x.ref, x.here])).toEqual([["broadcast", true, "Exodus 3:1", 4]]);
    clear();
    await h.call("POST", `/api/v1/broadcasts/${s.broadcast}/end`, { token: await h.token(4242, { name: "Rav Owner" }) });

    const res = await read(h, [s.room, s.broadcast, s.recording, s.quiet]);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.json as Status[]).map((x) => [x.id, x]));
    expect(Object.keys(byId).sort()).toEqual([s.room, s.broadcast, s.recording].sort());
    expect(byId[s.room]).toMatchObject({ kind: "room", live: true, ref: "Genesis 2:1", heRef: "בראשית ב:א", here: 3 });
    expect(byId[s.room]!.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(byId[s.broadcast]).toMatchObject({ kind: "broadcast", live: false, ref: "Exodus 3:1" });
    expect(byId[s.recording]).toEqual({
      id: s.recording,
      kind: "recording",
      live: false,
      ref: null,
      heRef: null,
      here: 0,
      updatedAt: null,
    });

    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[^"]+"$/);
    const again = await read(h, [s.room, s.broadcast, s.recording, s.quiet], { "if-none-match": etag! });
    expect([again.status, again.bytes.byteLength]).toEqual([304, 0]);

    await h.sql("update live_status set reported_at = now() - interval '4 minutes' where relay_room = $1", [s.room]);
    clear();
    const stale = (await read(h, [s.room])).json as Status[];
    expect(stale.map((x) => [x.live, x.ref])).toEqual([[false, "Genesis 2:1"]]);

    const fifty = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await read(h, [...fifty.slice(0, 49), s.room])).status).toBe(200);
    expect((await read(h, [...fifty, s.room])).status).toBe(400);
    expect((await h.call("GET", "/api/v1/live")).status).toBe(400);
    expect((await read(h, ["not-a-uuid"])).status).toBe(400);
  });
});
