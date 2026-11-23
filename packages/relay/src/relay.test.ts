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
    expect(await read("room-empty-0001", SECRET)).toEqual({ status: 200, body: { ref: null, title: null, participants: 0 } });

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
      body: { ref: "Genesis 1", title: "Genesis 1", participants: 2 },
    });
    expect((await read("room-status-01", null)).status).toBe(401);
    expect((await read("room-status-01", "wrong-secret-same-len")).status).toBe(401);
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
