// Acceptance tests for spec 011: joining and leaving rooms, the status passthrough, deletion reaching the relay, and CORS
// (L2, real Postgres), through the route tree. Each test first asserts its route is served, so on a base without the
// feature it fails on that assertion.
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

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
