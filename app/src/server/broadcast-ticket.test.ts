// Unit tests for broadcast tickets (spec 043): the exact wire format the relay verifies, checked against Node's own HMAC.
// @feature API-050 Broadcasts API: start, end, relay tickets and view-only call grants
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./broadcast-ticket.ts");
const load = async () => {
  expect(Object.keys(modules), "app/src/server/broadcast-ticket.ts").toEqual(["./broadcast-ticket.ts"]);
  return (await modules["./broadcast-ticket.ts"]!()) as typeof import("./broadcast-ticket");
};

const SECRET = "unit-test-relay-secret";
const B = "0b6f6a2e-3c1d-4e5f-8a9b-0c1d2e3f4a5b";
const NOW = 1_800_000_000;

describe("spec 043: broadcast tickets", () => {
  it("writes base64url(JSON {b, sub, role, exp}) and base64url(HMAC-SHA256 of that segment), without padding", async () => {
    const { signTicket } = await load();
    const ticket = await signTicket({ b: B, sub: "4242", role: "viewer", exp: NOW + 600 }, SECRET);
    const [body, sig] = ticket.split(".");
    expect(ticket.split(".")).toHaveLength(2);
    expect(Buffer.from(body!, "base64url").toString("utf8")).toBe(`{"b":"${B}","sub":"4242","role":"viewer","exp":${NOW + 600}}`);
    expect(sig).toBe(createHmac("sha256", SECRET).update(body!, "ascii").digest("base64url"));
    expect(ticket).not.toMatch(/[=+/]/);
  });

  it("verifies its own tickets and refuses tampered, expired, foreign or malformed ones", async () => {
    const { signTicket, verifyTicket } = await load();
    const claims = { b: B, sub: "4242", role: "host" as const, exp: NOW + 600 };
    const ticket = await signTicket(claims, SECRET);
    expect(await verifyTicket(ticket, SECRET, NOW)).toEqual(claims);

    const [body, sig] = ticket.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...claims, role: "viewer" })).toString("base64url");
    expect(await verifyTicket(`${forged}.${sig}`, SECRET, NOW), "tampered claims").toBeNull();
    expect(await verifyTicket(ticket, SECRET, NOW + 600), "expired").toBeNull();
    expect(await verifyTicket(ticket, "another-secret", NOW), "another secret").toBeNull();
    expect(await verifyTicket(ticket, undefined, NOW), "no secret").toBeNull();
    expect(await verifyTicket(body, SECRET, NOW), "no signature").toBeNull();
    expect(await verifyTicket(`${body}.${sig}.x`, SECRET, NOW), "three parts").toBeNull();
    expect(await verifyTicket(`${body}=.${sig}`, SECRET, NOW), "padding").toBeNull();
  });

  it("names the relay room b_<broadcast id>", async () => {
    const { relayRoomOf, TICKET_TTL_SECONDS } = await load();
    expect(relayRoomOf(B)).toBe(`b_${B}`);
    expect(relayRoomOf(B)).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(TICKET_TTL_SECONDS).toBe(600);
  });
});
