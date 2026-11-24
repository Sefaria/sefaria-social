// Acceptance tests for spec 032 (a live follow-me session shared in a post), L2: real Postgres through the route tree, and a
// stand-in for the reader's follow-me relay's status read (`GET /status/<id>`, the reader's src/lib/session/room-status.ts).
// @feature FEED-074 Share a live follow-me session in a post
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const followRelayModules = import.meta.glob<{ resetFollowStatusCache(): void }>("./server/services/follow-relay.ts");
const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type Post = { id: string; body: string; ref: string | null; followSessionId?: string | null };
const SESSION = "Zx9".repeat(14) + "Q";
const SECRET = "follow-relay-secret";
const post = async (h: H, token: string, body: Record<string, unknown>) =>
  (await h.call("POST", "/api/v1/posts", { token, body })).json as Post;

/** The relay's status read: answers for one session, counts requests, checks the secret. */
async function standInRelay(answer: () => unknown) {
  const seen: { path: string; auth: string | undefined }[] = [];
  const server: Server = createServer((req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function configure(url: string | null) {
  if (url) {
    process.env.FOLLOW_RELAY_URL = url;
    process.env.FOLLOW_RELAY_SECRET = SECRET;
  } else {
    delete process.env.FOLLOW_RELAY_URL;
    delete process.env.FOLLOW_RELAY_SECRET;
  }
  (await import("~/server/config")).resetConfig();
  const relayModule = followRelayModules["./server/services/follow-relay.ts"]; // absent before spec 032
  if (relayModule) (await relayModule()).resetFollowStatusCache();
}

afterEach(async () => configure(null));

describe("spec 032: a live follow-me session in a post", () => {
  // @ac 032/AC-001
  it("keeps the session of a follow link in the words or the source field, and takes the source from where the link opened", async () => {
    const h = await load();
    const leader = await h.token(5151, { name: "Rav Levi" });
    const inBody = await post(h, leader, {
      body: `Learning Shemot live now: https://www.sefaria.org/Exodus.3.2?lang=bi&follow=${SESSION}.`,
    });
    expect([inBody.followSessionId, inBody.ref]).toEqual([SESSION, "Exodus 3:2"]);
    const inRef = await post(h, leader, { body: "Join me", ref: `https://www.sefaria.org/Berakhot.2a.3?follow=${SESSION}` });
    expect([inRef.followSessionId, inRef.ref]).toEqual([SESSION, "Berakhot 2a:3"]);
    const named = await post(h, leader, { body: `With Rashi: /Exodus.3?follow=${SESSION}`, ref: "Rashi on Exodus 3:2" });
    expect([named.followSessionId, named.ref]).toEqual([SESSION, "Rashi on Exodus 3:2"]);
    const plain = await post(h, leader, { body: "No link /Exodus.3?follow=too-short", ref: "Exodus 3:2" });
    expect([plain.followSessionId, plain.ref]).toEqual([null, "Exodus 3:2"]);
  });

  // @ac 032/AC-002
  it("answers where the leader is now from the relay, shared by every viewer for a few seconds", async () => {
    expect(served("GET", "/api/v1/posts/$postId/follow"), "GET /api/v1/posts/{postId}/follow is served").toBeTypeOf("function");
    let url = "/Exodus.3.5?lang=bi";
    const relay = await standInRelay(() => ({ live: true, away: false, url, leader: "Rav Levi", participants: 6 }));
    try {
      await configure(relay.url);
      const h = await load();
      const leader = await h.token(5151, { name: "Rav Levi" });
      const learner = await h.token(4242);
      const other = await h.token(4343);
      const p = await post(h, leader, { body: `Live: https://www.sefaria.org/Exodus.3.2?follow=${SESSION}` });
      const first = await h.call("GET", `/api/v1/posts/${p.id}/follow`, { token: learner });
      expect([first.status, first.json]).toEqual([
        200,
        { live: true, away: false, ref: "Exodus 3:5", leader: "Rav Levi", participants: 6 },
      ]);
      url = "/Exodus.4.1";
      const second = await h.call("GET", `/api/v1/posts/${p.id}/follow`, { token: other });
      expect((second.json as { ref: string }).ref).toBe("Exodus 3:5"); // the same answer, within the few seconds
      expect(relay.seen).toEqual([{ path: `/status/${SESSION}`, auth: `Bearer ${SECRET}` }]);
    } finally {
      await relay.close();
    }
  });

  // @ac 032/AC-003
  it("says ended when the session is over or the relay cannot answer, 404 for a post without a session, 401 without a token", async () => {
    const relay = await standInRelay(() => ({ live: false, away: false, url: null, leader: null, participants: 0 }));
    try {
      await configure(relay.url);
      const h = await load();
      const leader = await h.token(5151);
      const p = await post(h, leader, { body: `Live: /Exodus.3?follow=${SESSION}` });
      const ended = { live: false, away: false, ref: null, leader: null, participants: 0 };
      expect((await h.call("GET", `/api/v1/posts/${p.id}/follow`, { token: leader })).json).toEqual(ended);
      await configure("http://127.0.0.1:9"); // nothing listens there
      expect((await h.call("GET", `/api/v1/posts/${p.id}/follow`, { token: leader })).json).toEqual(ended);
      const plain = await post(h, leader, { body: "No session" });
      expect((await h.call("GET", `/api/v1/posts/${plain.id}/follow`, { token: leader })).status).toBe(404);
      expect((await h.call("GET", `/api/v1/posts/${p.id}/follow`)).status).toBe(401);
    } finally {
      await relay.close();
    }
  });
});
