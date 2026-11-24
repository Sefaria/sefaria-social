// The broadcast filters and tickets (spec 043, T-002), pure: no workerd. The relay's own behaviour is in relay.test.ts.
import { describe, expect, it } from "vitest";
import { admitFromViewer, forViewer, isBroadcastRoom, withRole } from "./broadcast";
import type { Outgoing } from "./room";
import { signTicket, ticketFromProtocols, verifyTicket, type Ticket } from "./ticket";

const SECRET = "relay-internal-test-secret";
const NOW = 1_800_000_000;
const ticket: Ticket = { b: "abc123def", sub: "4242", role: "viewer", exp: NOW + 600 };
const msg = (ch: string, body: unknown) => JSON.stringify({ ch, body });

describe("broadcast filters", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("lets a viewer send only join, leave, hello and resync", () => {
    const admitted = [
      msg("control", { type: "join", participant: { id: "x", isHost: true, canLead: true } }),
      msg("control", { type: "leave" }),
      msg("state", { type: "hello", protocol: 1, slices: [], client: "t" }),
      msg("state", { type: "resync", of: "1" }),
    ];
    const dropped = [
      msg("state", { type: "keyframe", seq: 0, t: 0, snapshot: {} }),
      msg("state", { type: "change", seq: 1, t: 0, change: {} }),
      msg("presence", { type: "status", following: null, away: false }),
      msg("control", { type: "spotlight", to: "x" }),
      msg("control", { type: "raise-hand" }),
      msg("control", { type: "mode", mode: "open" }),
      msg("control", { type: "end" }),
      msg("chat", { type: "join" }),
      msg("toString", { type: "join" }),
      "not json",
      "null",
      JSON.stringify({ ch: "control" }),
      msg("control", { type: "leave", pad: "x".repeat(17_000) }),
    ];
    expect(admitted.map(admitFromViewer)).toEqual(admitted);
    expect(dropped.map(admitFromViewer)).toEqual(dropped.map(() => null));
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("gives a join the role's flags and leaves other messages alone", () => {
    const join = msg("control", { type: "join", participant: { id: "4242", name: "A", isHost: true, canLead: true } });
    expect(JSON.parse(withRole(join, "viewer")).body.participant).toEqual({
      id: "4242",
      name: "A",
      isHost: false,
      canLead: false,
    });
    const viewerJoin = msg("control", { type: "join", participant: { id: "1", isHost: false, canLead: false } });
    expect(JSON.parse(withRole(viewerJoin, "host")).body.participant).toEqual({ id: "1", isHost: true, canLead: true });
    const leave = msg("control", { type: "leave" });
    expect(withRole(leave, "viewer")).toBe(leave);
    expect(withRole("not json", "host")).toBe("not json");
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("shows a viewer a participants list with the host only, and passes other envelopes unchanged", () => {
    const p = (id: string, isHost: boolean) => ({ id, isHost, canLead: isHost, following: null, away: false });
    const list: Outgoing["envelope"] = {
      ch: "presence",
      t: 1,
      body: { type: "participants", participants: [p("1", false), p("9", true), p("2", false)] },
    };
    expect(forViewer(list)).toEqual({ ch: "presence", t: 1, body: { type: "participants", participants: [p("9", true)] } });
    expect(list.body.type === "participants" && list.body.participants).toHaveLength(3); // not mutated
    const room: Outgoing["envelope"] = {
      ch: "control",
      body: { type: "room", spotlight: "9", term: 1, mode: "presenter", hands: [], ended: false },
    };
    expect(forViewer(room)).toBe(room);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("knows a broadcast room by its b_ prefix", () => {
    expect([isBroadcastRoom("b_abc123def"), isBroadcastRoom("room-0000001"), isBroadcastRoom("bcast_abc12")]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("broadcast tickets", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("verifies a ticket it signed, and finds it among the offered subprotocols", async () => {
    const t = await signTicket(ticket, SECRET);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyTicket(t, SECRET, NOW)).toEqual(ticket);
    expect(await verifyTicket(t, SECRET, NOW)).toEqual(await verifyTicket(t, SECRET, NOW + 599));
    expect(ticketFromProtocols(`sefaria-social.v1, bearer.abc, ticket.${t}`)).toBe(t);
    expect([
      ticketFromProtocols(null),
      ticketFromProtocols("sefaria-social.v1, bearer.abc"),
      ticketFromProtocols("ticket."),
    ]).toEqual([null, null, null]);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("matches the server's format: base64url JSON payload, HMAC-SHA256 of that segment", async () => {
    const t = await signTicket(ticket, SECRET);
    const [body, sig] = t.split(".") as [string, string];
    expect(JSON.parse(Buffer.from(body, "base64url").toString("utf8"))).toEqual(ticket);
    const { createHmac } = await import("node:crypto");
    expect(sig).toBe(createHmac("sha256", SECRET).update(body, "ascii").digest("base64url"));
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  it("refuses an expired ticket, another secret, a tampered payload, a bad role or types, and no secret", async () => {
    const forge = async (payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const { createHmac } = await import("node:crypto");
      return `${body}.${createHmac("sha256", SECRET).update(body, "ascii").digest("base64url")}`;
    };
    const good = await signTicket(ticket, SECRET);
    const [, sig] = good.split(".") as [string, string];
    const tampered = `${Buffer.from(JSON.stringify({ ...ticket, role: "host" })).toString("base64url")}.${sig}`;
    const cases = {
      expired: await verifyTicket(await signTicket({ ...ticket, exp: NOW }, SECRET), SECRET, NOW),
      otherSecret: await verifyTicket(await signTicket(ticket, "another-secret"), SECRET, NOW),
      tampered: await verifyTicket(tampered, SECRET, NOW),
      badRole: await verifyTicket(await forge({ ...ticket, role: "admin" }), SECRET, NOW),
      numericSub: await verifyTicket(await forge({ ...ticket, sub: 4242 }), SECRET, NOW),
      stringExp: await verifyTicket(await forge({ ...ticket, exp: String(NOW + 600) }), SECRET, NOW),
      notObject: await verifyTicket(await forge("x"), SECRET, NOW),
      noSecret: await verifyTicket(good, undefined, NOW),
      emptySecret: await verifyTicket(good, "", NOW),
      threeParts: await verifyTicket(`${good}.x`, SECRET, NOW),
      garbage: await verifyTicket("not a ticket", SECRET, NOW),
    };
    expect(cases).toEqual(Object.fromEntries(Object.keys(cases).map((k) => [k, null])));
  });
});
