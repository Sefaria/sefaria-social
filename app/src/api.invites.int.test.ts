// Acceptance tests for spec 058 (the room invite bar's server side), L2: real Postgres through the route tree. Each test first
// asserts its route is served, so on a base without invitations it fails there.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const INVITES = "/api/v1/rooms/$roomId/invites";
const PEOPLE = "/api/v1/people";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type ErrorJson = { error: { code: string } };
type Results = { results: { to: string; status: string }[] };
type Notification = { kind: string; actor: { name: string } | null; room: { id: string; title: string } | null; read: boolean };
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

let nextUser = 958_000 + Math.floor(Math.random() * 1000) * 50;
const fresh = () => `t${randomBytes(4).toString("hex")}`;

/** A person with a known handle. */
async function person(h: H, name: string, handle: string) {
  const id = nextUser++;
  const token = await h.token(id, { name });
  const res = await h.call("PATCH", "/api/v1/profiles/me", { token, body: { handle } });
  expect(res.status, `handle ${handle}`).toBe(200);
  return { id, token, handle };
}

async function room(h: H, token: string, title: string): Promise<string> {
  return ((await h.call("POST", "/api/v1/rooms", { token, body: { title } })).json as { id: string }).id;
}

const invite = (h: H, token: string, roomId: string, to: unknown) =>
  h.call("POST", `/api/v1/rooms/${roomId}/invites`, { token, body: { to } });

const activity = async (h: H, token: string) =>
  ((await h.call("GET", "/api/v1/notifications", { token })).json as { notifications: Notification[] }).notifications;

describe("spec 058: room invitations", () => {
  // @feature API-052 Room invitations and people search
  // @ac 058/AC-001
  it("answers each entry: invited, member, self, not_found or invalid; refuses non-members and too many entries", async () => {
    expect(served("POST", INVITES), `POST ${INVITES} is served`).toBeTypeOf("function");
    const h = await load();
    const w = fresh();
    const rachel = await person(h, "Rachel", `rachel_${w}`);
    const ben = await person(h, "Ben", `ben_${w}`);
    const dina = await person(h, "Dina", `dina_${w}`);
    const roomId = await room(h, rachel.token, "Daf Yomi");
    await h.call("POST", `/api/v1/rooms/${roomId}/members`, { token: dina.token });
    const [shul] = await h.sql<{ handle: string }>(
      "insert into profiles (kind, name) values ('institution', $1) returning handle",
      [`Shul ${w}`],
    );
    const res = await invite(h, rachel.token, roomId, [
      `@${ben.handle}`,
      dina.handle.toUpperCase(),
      `@${rachel.handle}`,
      `@nobody_${w}`,
      `@${shul!.handle}`,
      "!!",
    ]);
    expect(res.status).toBe(200);
    expect((res.json as Results).results).toEqual([
      { to: `@${ben.handle}`, status: "invited" },
      { to: dina.handle.toUpperCase(), status: "member" },
      { to: `@${rachel.handle}`, status: "self" },
      { to: `@nobody_${w}`, status: "not_found" },
      { to: `@${shul!.handle}`, status: "not_found" },
      { to: "!!", status: "invalid" },
    ]);
    expect(code(await invite(h, ben.token, roomId, [`@${dina.handle}`]))).toBe("404 room.not_found");
    expect(code(await invite(h, rachel.token, "6f1c2d3e-4b5a-4c6d-8e7f-001122334455", [`@${ben.handle}`]))).toBe(
      "404 room.not_found",
    );
    expect(
      (
        await invite(
          h,
          rachel.token,
          roomId,
          Array.from({ length: 21 }, (_, i) => `@x${i}_${w}`),
        )
      ).status,
    ).toBe(400);
    expect((await invite(h, rachel.token, roomId, [])).status).toBe(400);
    expect((await invite(h, rachel.token, roomId, ["x".repeat(321)])).status).toBe(400);
    expect((await h.call("POST", `/api/v1/rooms/${roomId}/invites`, { body: { to: ["@x"] } })).status).toBe(401);
  });

  // @feature ROOM-055 The invite bar in a room, and invitations in activity
  // @ac 058/AC-002
  it("tells the invited person once a day per room, naming the inviter and the room", async () => {
    expect(served("POST", INVITES), `POST ${INVITES} is served`).toBeTypeOf("function");
    const h = await load();
    const w = fresh();
    const rachel = await person(h, "Rachel Cohen", `rachel_${w}`);
    const ben = await person(h, "Ben", `ben_${w}`);
    const roomId = await room(h, rachel.token, `Daf Yomi ${w}`);
    await invite(h, rachel.token, roomId, [`@${ben.handle}`]);
    await invite(h, rachel.token, roomId, [`@${ben.handle}`, `@${ben.handle}`]);
    const invites = (await activity(h, ben.token)).filter((n) => n.kind === "room_invite");
    expect(invites).toEqual([
      expect.objectContaining({
        kind: "room_invite",
        actor: expect.objectContaining({ name: "Rachel Cohen" }),
        room: { id: roomId, title: `Daf Yomi ${w}` },
        read: false,
      }),
    ]);
    // A day later the same invitation tells them again.
    await h.sql("update room_invites set created_at = now() - interval '25 hours' where room_id = $1", [roomId]);
    await invite(h, rachel.token, roomId, [`@${ben.handle}`]);
    expect((await activity(h, ben.token)).filter((n) => n.kind === "room_invite")).toHaveLength(2);
    // The invitation goes with the room.
    await h.call("DELETE", `/api/v1/rooms/${roomId}`, { token: rachel.token });
    expect((await activity(h, ben.token)).filter((n) => n.kind === "room_invite")).toEqual([]);
  });

  // @feature API-052 Room invitations and people search
  // @ac 058/AC-003
  it("refuses more than 50 invitations an hour with 429 and retry-after", async () => {
    expect(served("POST", INVITES), `POST ${INVITES} is served`).toBeTypeOf("function");
    const h = await load();
    const w = fresh();
    const rachel = await person(h, "Rachel", `rachel_${w}`);
    const ben = await person(h, "Ben", `ben_${w}`);
    const roomId = await room(h, rachel.token, "Busy room");
    await h.sql(
      "insert into room_invites (room_id, inviter_user_id, invitee_user_id) select $1, $2, 1 from generate_series(1, 50)",
      [roomId, rachel.id],
    );
    const refused = await invite(h, rachel.token, roomId, [`@${ben.handle}`]);
    expect(code(refused)).toBe("429 invite.rate_limited");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    await h.sql("update room_invites set created_at = now() - interval '61 minutes' where inviter_user_id = $1", [rachel.id]);
    expect((await invite(h, rachel.token, roomId, [`@${ben.handle}`])).status).toBe(200);
  });

  // @feature API-052 Room invitations and people search
  // @ac 058/AC-004
  it("finds up to 8 people by handle prefix or name, handles first, with public fields only", async () => {
    expect(served("GET", PEOPLE), `GET ${PEOPLE} is served`).toBeTypeOf("function");
    const h = await load();
    const w = fresh();
    const viewer = await person(h, "Viewer", `viewer_${w}`);
    await person(h, `Name has ${w} in it`, `zz_named_${w}`);
    for (let i = 0; i < 9; i++) await person(h, `Person ${i}`, `${w}_p${i}`);
    const search = async (q: string) =>
      (await h.call("GET", `/api/v1/people?q=${encodeURIComponent(q)}`, { token: viewer.token })).json as {
        people: Record<string, unknown>[];
      };
    const found = (await search(`@${w}`)).people;
    expect(found).toHaveLength(8);
    expect(found.every((p) => String(p.handle).startsWith(w))).toBe(true);
    expect(Object.keys(found[0]!).sort()).toEqual(["handle", "id", "kind", "name"]);
    const byName = (await search(`has ${w}`)).people;
    expect(byName.map((p) => p.handle)).toEqual([`zz_named_${w}`]);
    // LIKE's wildcards are taken literally.
    expect((await search("%")).people.every((p) => String(p.name).includes("%") || String(p.handle).startsWith("%"))).toBe(true);
    expect((await h.call("GET", "/api/v1/people?q=", { token: viewer.token })).status).toBe(400);
    expect((await h.call("GET", `/api/v1/people?q=${"x".repeat(31)}`, { token: viewer.token })).status).toBe(400);
    expect((await h.call("GET", `/api/v1/people?q=${w}`)).status).toBe(401);
  });
});
