// The relay in the Workers runtime (spec 010; L2). Runs in the `relay` Vitest project: workerd through Miniflare, real
// WebSockets, tokens signed by a per-run key and verified against its JWKS. The worker is loaded through import.meta.glob first
// so that, on a base without packages/relay, the first assertion fails (prove-red).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Support from "../test-support/relay";

const workers = import.meta.glob("./worker.ts");
const supports = import.meta.glob<typeof Support>("../test-support/relay.ts");

let support: typeof Support;
let relay: Support.Relay;

beforeAll(async () => {
  const s = await supports["../test-support/relay.ts"]?.();
  if (!s) return; // the base: every test fails on its first assertion
  support = s;
  relay = await support.startRelay();
}, 60_000);

afterAll(async () => {
  await relay?.close();
});

const protocolsFor = (token: string) => ["sefaria-social.v1", `bearer.${token}`];

describe("relay", () => {
  // Broadcast tickets as the social server signs them (design 6.2), signed here independently of the relay's own code.
  const ticketFor = async (claims: { b: string; sub: string; role: "host" | "viewer"; expSeconds?: number }, secret?: string) => {
    const { createHmac } = await import("node:crypto");
    const exp = Math.floor(Date.now() / 1000) + (claims.expSeconds ?? 600);
    const body = Buffer.from(JSON.stringify({ b: claims.b, sub: claims.sub, role: claims.role, exp })).toString("base64url");
    const sig = createHmac("sha256", secret ?? support.SECRET)
      .update(body, "ascii")
      .digest("base64url");
    return `${body}.${sig}`;
  };
  const broadcastProtocols = async (sub: string, ticket: string) => [
    ...protocolsFor(await relay.token({ sub })),
    `ticket.${ticket}`,
  ];

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-003
  it("refuses a broadcast room without a valid ticket for that broadcast and the token's user", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect } = support;
    const room = "/r/b_ticket-0001";
    const b = "ticket-0001";
    const cases = {
      noTicket: await connect(relay.mf, room, { protocols: protocolsFor(await relay.token({ sub: "4242" })) }),
      otherBroadcast: await connect(relay.mf, room, {
        protocols: await broadcastProtocols("4242", await ticketFor({ b: "ticket-0002", sub: "4242", role: "viewer" })),
      }),
      otherUser: await connect(relay.mf, room, {
        protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "5151", role: "viewer" })),
      }),
      expired: await connect(relay.mf, room, {
        protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "viewer", expSeconds: -1 })),
      }),
      otherSecret: await connect(relay.mf, room, {
        protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "host" }, "not-the-relay-secret")),
      }),
      garbage: await connect(relay.mf, room, { protocols: await broadcastProtocols("4242", "not.a-ticket") }),
    };
    expect(Object.fromEntries(Object.entries(cases).map(([k, p]) => [k, p.status]))).toEqual({
      noTicket: 401,
      otherBroadcast: 401,
      otherUser: 401,
      expired: 401,
      otherSecret: 401,
      garbage: 401,
    });

    const ok = await connect(relay.mf, room, {
      protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "viewer" })),
    });
    expect({ status: ok.status, protocol: ok.protocol }).toEqual({ status: 101, protocol: "sefaria-social.v1" });
    // A ticket changes nothing in an ordinary room.
    const plain = await connect(relay.mf, "/r/room-ticket-01", {
      protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "viewer" })),
    });
    expect(plain.status).toBe(101);

    // The role comes from the ticket only: a client's own X-Relay-Role header is overwritten (or removed in an ordinary room).
    const spoof = async (path: string, protocols: string[], role: string) => {
      const res = await relay.mf.dispatchFetch(`http://relay.test${path}`, {
        headers: {
          Upgrade: "websocket",
          Origin: support.ORIGIN,
          "Sec-WebSocket-Protocol": protocols.join(", "),
          "X-Relay-Role": role,
        },
      });
      const socket = res.webSocket!;
      const received: { ch?: string; body?: { type?: string; participants?: { id: string; isHost: boolean }[] } }[] = [];
      socket.accept();
      socket.addEventListener("message", (e) => received.push(JSON.parse(String(e.data))));
      socket.send(JSON.stringify(support.join("4242")));
      await vi.waitFor(() => expect(received.some((m) => m.body?.type === "participants")).toBe(true));
      socket.close();
      return received.find((m) => m.body?.type === "participants")?.body?.participants;
    };
    // Still a viewer: not a host, so the list it sees (the host only) leaves it out.
    expect(
      await spoof(
        "/r/b_ticket-0001",
        await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "viewer" })),
        "host",
      ),
    ).toEqual([]);
    expect(await spoof("/r/room-ticket-02", protocolsFor(await relay.token({ sub: "4242" })), "viewer")).toEqual([
      expect.objectContaining({ id: "4242", isHost: true }),
    ]);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-004
  it("lets a viewer only watch: its join is not a host's, what else it sends is dropped, and it sees the host only", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants } = support;
    const b = "watch-0001";
    const room = `/r/b_${b}`;
    const host = await connect(relay.mf, room, {
      protocols: await broadcastProtocols("4242", await ticketFor({ b, sub: "4242", role: "host" })),
    });
    host.send({ ch: "control", body: { type: "join", participant: { id: "4242", isHost: false, canLead: false } } });
    const snapshot = (url: string) => ({ v: 1, url, nav: null, slices: {} });
    host.send({ ch: "state", body: { type: "keyframe", seq: 0, t: 0, snapshot: snapshot("/Genesis.1") } });
    await vi.waitFor(() =>
      expect(lastParticipants(host)).toEqual([expect.objectContaining({ id: "4242", isHost: true, canLead: true })]),
    );

    const viewer = await connect(relay.mf, room, {
      protocols: await broadcastProtocols("5151", await ticketFor({ b, sub: "5151", role: "viewer" })),
    });
    const other = await connect(relay.mf, room, {
      protocols: await broadcastProtocols("6161", await ticketFor({ b, sub: "6161", role: "viewer" })),
    });
    expect([host.status, viewer.status, other.status]).toEqual([101, 101, 101]);
    viewer.send(join("5151")); // claims isHost and canLead
    other.send(join("6161"));
    await vi.waitFor(() => expect(lastParticipants(host)).toHaveLength(3));
    expect(lastParticipants(host)).toEqual([
      expect.objectContaining({ id: "4242", isHost: true, canLead: true }),
      expect.objectContaining({ id: "5151", isHost: false, canLead: false }),
      expect.objectContaining({ id: "6161", isHost: false, canLead: false }),
    ]);

    // Everything a viewer may not do; none of it reaches the room.
    viewer.send({ ch: "state", body: { type: "keyframe", seq: 0, t: 0, snapshot: snapshot("/Exodus.1") } });
    viewer.send({ ch: "state", body: { type: "change", seq: 1, t: 1, change: { url: "/Exodus.2" } } });
    viewer.send({ ch: "presence", body: { type: "status", following: "6161", away: true } });
    viewer.send({ ch: "control", body: { type: "spotlight", to: "5151" } });
    viewer.send({ ch: "control", body: { type: "mode", mode: "open" } });
    viewer.send({ ch: "control", body: { type: "raise-hand" } });
    viewer.send({ ch: "control", body: { type: "end" } });
    // A resync is let through: its answer proves the viewer's earlier messages have all been handled.
    viewer.send({ ch: "state", body: { type: "resync", of: "4242" } });
    const keyframesFromHost = () =>
      viewer.received.filter(
        (m) =>
          (m as { ch?: string; from?: string; body?: { type?: string } }).ch === "state" &&
          (m as { from?: string }).from === "4242",
      );
    await vi.waitFor(() => expect(keyframesFromHost().length).toBeGreaterThan(0));

    host.send({ ch: "control", body: { type: "spotlight", to: "4242" } }); // answered with the room's state
    host.send({ ch: "state", body: { type: "keyframe", seq: 1, t: 2, snapshot: snapshot("/Genesis.2") } });
    await vi.waitFor(() =>
      expect(keyframesFromHost().map((m) => (m as { body: { snapshot?: { url?: string } } }).body.snapshot?.url)).toContain(
        "/Genesis.2",
      ),
    );
    const roomStates = host.received.filter(
      (m) =>
        (m as { ch?: string; body?: { type?: string } }).ch === "control" &&
        (m as { body: { type: string } }).body.type === "room",
    ) as { body: { spotlight: string | null; mode: string; ended: boolean } }[];
    expect(roomStates.at(-1)?.body).toEqual(expect.objectContaining({ spotlight: "4242", mode: "presenter", ended: false }));
    expect(roomStates.every((m) => m.body.spotlight === "4242" && !m.body.ended)).toBe(true);
    expect(host.received.filter((m) => (m as { from?: string }).from === "5151")).toEqual([]);
    expect(lastParticipants(host)?.find((p) => p.id === "5151")).toEqual(
      expect.objectContaining({ following: null, away: false }),
    );
    // Viewers see the host only, never each other.
    expect(lastParticipants(viewer)?.map((p) => p.id)).toEqual(["4242"]);
    expect(lastParticipants(other)?.map((p) => p.id)).toEqual(["4242"]);
  });

  // @feature SESS-010 Relay: one Durable Object per room in the Workers runtime
  // @ac 010/AC-001
  it("puts two sockets of one room in one Durable Object, and refuses bad paths, plain requests and foreign Origins", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants } = support;
    const a = await connect(relay.mf, "/r/room-0000001", { protocols: protocolsFor(await relay.token({ sub: "4242" })) });
    const b = await connect(relay.mf, "/r/room-0000001", { protocols: protocolsFor(await relay.token({ sub: "5151" })) });
    expect([a.status, b.status]).toEqual([101, 101]);
    a.send(join("4242"));
    b.send(join("5151"));
    await vi.waitFor(() =>
      expect(
        lastParticipants(a)
          ?.map((p) => p.id)
          .sort(),
      ).toEqual(["4242", "5151"]),
    );
    await vi.waitFor(() =>
      expect(
        lastParticipants(b)
          ?.map((p) => p.id)
          .sort(),
      ).toEqual(["4242", "5151"]),
    );

    const token = await relay.token({ sub: "4242" });
    const badPath = await connect(relay.mf, "/r/x", { protocols: protocolsFor(token) });
    const plain = await relay.mf.dispatchFetch("http://relay.test/r/room-0000001", { headers: { Origin: support.ORIGIN } });
    await plain.arrayBuffer();
    const foreign = await connect(relay.mf, "/r/room-0000001", {
      origin: "https://evil.example",
      protocols: protocolsFor(token),
    });
    const noOrigin = await connect(relay.mf, "/r/room-0000001", { origin: null, protocols: protocolsFor(token) });
    expect([badPath.status, plain.status, foreign.status, noOrigin.status]).toEqual([404, 426, 403, 403]);
  });

  // @feature IDENT-041 Relay accepts only verified Sefaria tokens
  // @ac 010/AC-002
  it("refuses no token, a foreign key, an expired token, a wrong issuer or audience, and a token in the URL; answers only its subprotocol", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect } = support;
    const room = "/r/room-auth-0001";
    const cases = {
      none: await connect(relay.mf, room),
      bearerOnly: await connect(relay.mf, room, { protocols: [`bearer.${await relay.token({ sub: "4242" })}`] }),
      otherKey: await connect(relay.mf, room, { protocols: protocolsFor(await relay.token({ sub: "4242" }, relay.otherKey)) }),
      expired: await connect(relay.mf, room, { protocols: protocolsFor(await relay.token({ sub: "4242", expSeconds: -120 })) }),
      wrongIssuer: await connect(relay.mf, room, {
        protocols: protocolsFor(await relay.token({ sub: "4242", iss: "https://evil.example" })),
      }),
      wrongAudience: await connect(relay.mf, room, { protocols: protocolsFor(await relay.token({ sub: "4242", aud: "other" })) }),
      urlOnly: await connect(relay.mf, `${room}?token=${await relay.token({ sub: "4242" })}`, {
        protocols: ["sefaria-social.v1"],
      }),
      garbage: await connect(relay.mf, room, { protocols: protocolsFor("not.a.jwt") }),
    };
    expect(Object.fromEntries(Object.entries(cases).map(([k, p]) => [k, p.status]))).toEqual({
      none: 401,
      bearerOnly: 401,
      otherKey: 401,
      expired: 401,
      wrongIssuer: 401,
      wrongAudience: 401,
      urlOnly: 401,
      garbage: 401,
    });

    const ok = await connect(relay.mf, room, { protocols: protocolsFor(await relay.token({ sub: "4242" })) });
    expect({ status: ok.status, protocol: ok.protocol }).toEqual({ status: 101, protocol: "sefaria-social.v1" });
  });

  // @feature IDENT-041 Relay accepts only verified Sefaria tokens
  // @ac 010/AC-003
  it("uses the token's sub and name for the participant, whatever the join claims", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants } = support;
    const peer = await connect(relay.mf, "/r/room-ident-001", {
      protocols: protocolsFor(await relay.token({ sub: "4242", name: "Test Learner" })),
    });
    peer.send(join("someone-else", "Impostor"));
    await vi.waitFor(() =>
      expect(lastParticipants(peer)).toEqual([expect.objectContaining({ id: "4242", name: "Test Learner" })]),
    );
  });

  // @feature SESS-042 Relay status read for cards
  // @ac 010/AC-004
  it("answers the status read from the spotlight's summary slice and the joined count, only with the secret", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants, SECRET } = support;
    const read = async (room: string, secret: string | null) => {
      const res = await relay.mf.dispatchFetch(`http://relay.test/internal/status/${room}`, {
        headers: secret === null ? {} : { Authorization: `Bearer ${secret}` },
      });
      return { status: res.status, body: await res.json() };
    };
    expect(await read("room-empty-0001", SECRET)).toEqual({
      status: 200,
      body: { ref: null, heRef: null, title: null, participants: 0 },
    });

    const leader = await connect(relay.mf, "/r/room-status-01", { protocols: protocolsFor(await relay.token({ sub: "4242" })) });
    leader.send(join("4242"));
    const summary = { "social.summary": { v: 1, value: { ref: "Genesis 1", title: "Genesis 1" } } };
    leader.send({
      ch: "state",
      body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", nav: null, slices: summary } },
    });
    const other = await connect(relay.mf, "/r/room-status-01", { protocols: protocolsFor(await relay.token({ sub: "5151" })) });
    other.send(join("5151"));
    await vi.waitFor(() => expect(lastParticipants(other)).toHaveLength(2));

    expect(await read("room-status-01", SECRET)).toEqual({
      status: 200,
      body: { ref: "Genesis 1", heRef: null, title: "Genesis 1", participants: 2 },
    });
    expect((await read("room-status-01", null)).status).toBe(401);
    expect((await read("room-status-01", "wrong-secret-same-len")).status).toBe(401);
  });

  // @feature SESS-054 Stream summary carries heRef and the source's title
  // @ac 016/AC-004
  it("passes the summary's heRef on in the status read, and refuses one that is not a short string", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants, SECRET } = support;
    const read = async (room: string) =>
      (
        await relay.mf.dispatchFetch(`http://relay.test/internal/status/${room}`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        })
      ).json();
    const publish = async (room: string, value: unknown) => {
      const peer = await connect(relay.mf, `/r/${room}`, { protocols: protocolsFor(await relay.token({ sub: "4242" })) });
      peer.send(join("4242"));
      const slices = { "social.summary": { v: 1, value } };
      peer.send({
        ch: "state",
        body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", nav: null, slices } },
      });
      await vi.waitFor(() => expect(lastParticipants(peer)).toHaveLength(1));
    };
    await publish("room-heref-001", { ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis" });
    await publish("room-heref-002", { ref: "Genesis 1", heRef: { html: "<b>x</b>" }, title: "Genesis" });
    await vi.waitFor(async () =>
      expect(await read("room-heref-001")).toEqual({ ref: "Genesis 1", heRef: "בראשית א׳", title: "Genesis", participants: 1 }),
    );
    expect(await read("room-heref-002")).toEqual({ ref: "Genesis 1", heRef: null, title: "Genesis", participants: 1 });
  });

  // @feature IDENT-043 Relay drops a deleted user
  // @ac 010/AC-005
  it("closes a deleted user's sockets and refuses their upgrades everywhere; without the secret it drops nobody", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants, SECRET } = support;
    const drop = async (secret: string | null, userId: string) => {
      const res = await relay.mf.dispatchFetch("http://relay.test/internal/drop-user", {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }) },
        body: JSON.stringify({ userId, rooms: ["room-drop-0001"] }),
      });
      await res.arrayBuffer();
      return res.status;
    };
    const doomed = await connect(relay.mf, "/r/room-drop-0001", { protocols: protocolsFor(await relay.token({ sub: "7777" })) });
    const stays = await connect(relay.mf, "/r/room-drop-0001", { protocols: protocolsFor(await relay.token({ sub: "8888" })) });
    doomed.send(join("7777"));
    stays.send(join("8888"));
    await vi.waitFor(() => expect(lastParticipants(stays)).toHaveLength(2));

    // Without the secret: refused, nobody dropped.
    expect(await drop(null, "7777")).toBe(401);
    expect(await drop("not-the-secret", "8888")).toBe(401);
    expect([doomed.closed, stays.closed]).toEqual([false, false]);

    expect(await drop(SECRET, "7777")).toBe(200);
    await vi.waitFor(() => expect(doomed.closed).toBe(true));
    await vi.waitFor(() => expect(lastParticipants(stays)?.map((p) => p.id)).toEqual(["8888"]));
    const again = await connect(relay.mf, "/r/room-elsewhere1", { protocols: protocolsFor(await relay.token({ sub: "7777" })) });
    const other = await connect(relay.mf, "/r/room-elsewhere1", { protocols: protocolsFor(await relay.token({ sub: "8888" })) });
    expect([again.status, other.status]).toEqual([401, 101]);
  });
});
