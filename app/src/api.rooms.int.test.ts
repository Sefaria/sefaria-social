// Acceptance tests for spec 007: rooms with ownership and membership checks (L2, real Postgres), through the route tree.
// @feature ROOM-007 Create, list, rename and delete rooms with ownership checks
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type Room = { id: string; title: string; ownerUserId: number; role: string; createdAt: string; updatedAt: string };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

describe("spec 007: rooms", () => {
  // @ac 007/AC-001
  it("creates a room owned by the caller and caches their display name", async () => {
    expect(served("POST", "/api/v1/rooms"), "POST /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const token = await h.token(4242, { name: "Test Learner", picture: "https://www.sefaria.test/img/u.png" });
    const res = await h.call("POST", "/api/v1/rooms", { token, body: { title: "  Daf Yomi  " } });
    expect(res.status).toBe(201);
    const room = res.json as Room;
    expect(room).toMatchObject({ title: "Daf Yomi", ownerUserId: 4242, role: "owner" });
    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(room.createdAt)).not.toBeNaN();
    expect(await h.sql("select user_id, role from room_members where room_id = $1", [room.id])).toEqual([
      { user_id: "4242", role: "owner" },
    ]);
    expect(await h.sql("select user_id, name, img from user_display")).toEqual([
      { user_id: "4242", name: "Test Learner", img: "https://www.sefaria.test/img/u.png" },
    ]);
  });

  // @ac 007/AC-002
  it("lists only the caller's rooms, newest first", async () => {
    expect(served("GET", "/api/v1/rooms"), "GET /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const me = await h.token(4242);
    const other = await h.token(5151);
    await h.call("POST", "/api/v1/rooms", { token: me, body: { title: "First" } });
    await h.call("POST", "/api/v1/rooms", { token: other, body: { title: "Other" } });
    await h.call("POST", "/api/v1/rooms", { token: me, body: { title: "Second" } });
    const res = await h.call("GET", "/api/v1/rooms", { token: me });
    expect(res.status).toBe(200);
    expect((res.json as { rooms: Room[] }).rooms.map((r) => r.title)).toEqual(["Second", "First"]);
  });

  // @ac 007/AC-003
  it("answers 404 to a non-member, the same as for a missing room, and changes nothing", async () => {
    expect(served("GET", "/api/v1/rooms/$roomId"), "GET /api/v1/rooms/$roomId is served").toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const stranger = await h.token(4242);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Private" } })).json as Room;
    const answers: string[] = [];
    for (const id of [room.id, MISSING])
      for (const [method, body] of [
        ["GET", undefined],
        ["PATCH", { title: "Hijacked" }],
        ["DELETE", undefined],
      ] as const) {
        const res = await h.call(method, `/api/v1/rooms/${id}`, { token: stranger, ...(body ? { body } : {}) });
        answers.push(`${method} ${res.status} ${JSON.stringify(res.json)}`);
      }
    const notFound = JSON.stringify({ error: { code: "room.not_found", message: "Room not found." } });
    expect(answers).toEqual(["GET", "PATCH", "DELETE", "GET", "PATCH", "DELETE"].map((m) => `${m} 404 ${notFound}`));
    expect(await h.sql("select title from rooms")).toEqual([{ title: "Private" }]);
  });

  // @ac 007/AC-004
  it("lets only the owner rename or delete", async () => {
    expect(served("PATCH", "/api/v1/rooms/$roomId"), "PATCH /api/v1/rooms/$roomId is served").toBeTypeOf("function");
    const h = await load();
    const owner = await h.token(5151);
    const member = await h.token(4242);
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Shared" } })).json as Room;
    // Joining arrives with the P3 specs; seed the membership directly.
    await h.sql("insert into room_members (room_id, user_id, role) values ($1, 4242, 'member')", [room.id]);

    const seen = await h.call("GET", `/api/v1/rooms/${room.id}`, { token: member });
    expect(seen.status).toBe(200);
    expect(seen.json).toMatchObject({ title: "Shared", role: "member", ownerUserId: 5151 });

    const rename = await h.call("PATCH", `/api/v1/rooms/${room.id}`, { token: member, body: { title: "Mine now" } });
    const remove = await h.call("DELETE", `/api/v1/rooms/${room.id}`, { token: member });
    expect([rename.status, remove.status]).toEqual([403, 403]);
    expect(rename.json).toMatchObject({ error: { code: "room.forbidden" } });
    expect(await h.sql("select title from rooms")).toEqual([{ title: "Shared" }]);

    const renamed = await h.call("PATCH", `/api/v1/rooms/${room.id}`, { token: owner, body: { title: "Renamed" } });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({ id: room.id, title: "Renamed", role: "owner" });
    expect(Date.parse((renamed.json as Room).updatedAt)).toBeGreaterThanOrEqual(Date.parse(room.updatedAt));

    const deleted = await h.call("DELETE", `/api/v1/rooms/${room.id}`, { token: owner });
    expect(deleted.status).toBe(204);
    expect(deleted.json).toBeNull();
    expect(await h.sql("select count(*)::int as n from rooms")).toEqual([{ n: 0 }]);
    expect(await h.sql("select count(*)::int as n from room_members")).toEqual([{ n: 0 }]);
  });

  // @ac 007/AC-005
  it("refuses input that does not match the schema", async () => {
    expect(served("POST", "/api/v1/rooms"), "POST /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const token = await h.token(4242);
    const invalid = [
      await h.call("POST", "/api/v1/rooms", { token, body: { title: "   " } }),
      await h.call("POST", "/api/v1/rooms", { token, body: { title: "x".repeat(121) } }),
      await h.call("POST", "/api/v1/rooms", { token, body: { title: "ok", extra: true } }),
      await h.call("POST", "/api/v1/rooms", { token, rawBody: "{not json" }),
      await h.call("GET", "/api/v1/rooms/not-a-uuid", { token }),
      await h.call("PATCH", "/api/v1/rooms/not-a-uuid", { token, body: { title: "ok" } }),
    ];
    expect(invalid.map((r) => `${r.status} ${(r.json as { error: { code: string } }).error.code}`)).toEqual(
      Array(6).fill("400 request.invalid"),
    );
    expect(await h.sql("select count(*)::int as n from rooms")).toEqual([{ n: 0 }]);
    const wrongMethod = await h.call("PUT", "/api/v1/rooms", { token, body: { title: "ok" } });
    expect(wrongMethod.status).toBe(405);
  });
});
