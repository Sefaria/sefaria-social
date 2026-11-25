// Acceptance test for spec 048 AC-004, server side: any member of a room gets a 10-minute relay ticket naming them and their
// role, owner for the room's owner and member for anyone else; someone who is not a member gets 404 (L2, real Postgres),
// through the route tree. The ticket is checked with Node's own HMAC. The test first asserts its route is served, so on a base
// without the feature it fails on that assertion.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const TICKET = "/api/v1/rooms/$roomId/ticket";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Room = { id: string };
type Ticket = { ticket: string; role: string; relayRoom: string; expiresAt: string };
type ErrorJson = { error: { code: string } };

const OWNER = 948001;
const MEMBER = 948002;
const STRANGER = 948003;
const RELAY_SECRET = "integration-test-relay-secret";
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("spec 048: room relay tickets", () => {
  // @feature SESS-071 The room's owner is its one leader
  // @ac 048/AC-004
  it("signs a 10-minute ticket naming the member and their role, and refuses someone who is not a member", async () => {
    expect(served("POST", TICKET), `POST ${TICKET} is served`).toBeTypeOf("function");
    const mod = await import("../../test/integration/harness");
    const h = await mod.harness(getRouter());
    process.env.RELAY_INTERNAL_SECRET = RELAY_SECRET;
    const { resetConfig } = await import("~/server/config");
    resetConfig();
    cleanup = () => {
      delete process.env.RELAY_INTERNAL_SECRET;
      resetConfig();
    };
    const owner = await h.token(OWNER, { name: "Owner" });
    const member = await h.token(MEMBER, { name: "Member" });
    const stranger = await h.token(STRANGER, { name: "Stranger" });
    const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Chavruta" } })).json as Room;
    await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: member });
    const ticket = (token: string, id = room.id) => h.call("POST", `/api/v1/rooms/${id}/ticket`, { token });

    for (const [token, userId, role] of [
      [owner, OWNER, "owner"],
      [member, MEMBER, "member"],
    ] as const) {
      const before = Math.floor(Date.now() / 1000);
      const res = await ticket(token);
      const after = Math.floor(Date.now() / 1000);
      expect(res.status, role).toBe(200);
      const t = res.json as Ticket;
      expect(t.role).toBe(role);
      expect(t.relayRoom).toBe(room.id);
      const [body, sig] = t.ticket.split(".") as [string, string];
      expect(sig, "signed with the relay secret over the first segment").toBe(
        createHmac("sha256", RELAY_SECRET).update(body, "ascii").digest("base64url"),
      );
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
      expect(Object.keys(claims)).toEqual(["b", "sub", "role", "exp"]);
      expect(claims).toMatchObject({ b: room.id, sub: String(userId), role });
      expect(claims.exp).toBeGreaterThanOrEqual(before + 600);
      expect(claims.exp).toBeLessThanOrEqual(after + 600);
      expect(t.expiresAt).toBe(new Date((claims.exp as number) * 1000).toISOString());
    }

    expect(code(await ticket(stranger)), "not a member").toBe("404 room.not_found");
    delete process.env.RELAY_INTERNAL_SECRET;
    resetConfig();
    expect(code(await ticket(owner)), "no relay secret").toBe("503 room.relay_unavailable");
    expect(code(await ticket(stranger)), "not a member, even without a secret").toBe("404 room.not_found");
  });
});
