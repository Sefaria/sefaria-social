// Acceptance tests for spec 006: identity token verification (L2, real Postgres, local JWKS), through the served route tree.
// @feature IDENT-006 Sefaria identity token verified on every API call
// @feature API-006 API routes are protected by default
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe("spec 006: token verification", () => {
  // @ac 006/AC-001
  it("runs the handler as the token's user", async () => {
    expect(served("POST", "/api/v1/rooms"), "POST /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const token = await h.token(4242, { name: "Test Learner" });
    const res = await h.call("POST", "/api/v1/rooms", { token, body: { title: "Who am I" } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ ownerUserId: 4242, role: "owner" });
    expect(await h.sql("select user_id, name from user_display")).toEqual([{ user_id: "4242", name: "Test Learner" }]);
  });

  // @ac 006/AC-002
  it("refuses invalid tokens with 401 before the handler runs", async () => {
    expect(served("POST", "/api/v1/rooms"), "POST /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const other = await generateKeyPair("RS256");
    const hs256 = new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!");
    const cases: [string, string | undefined][] = [
      ["absent", undefined],
      ["not a JWT", "not-a-jwt"],
      ["expired", await h.token(4242, {}, { expiresIn: Math.floor(Date.now() / 1000) - 120 })],
      ["signed by a key not in the JWKS", await h.token(4242, {}, { key: other.privateKey })],
      ["signed with HS256", await h.token(4242, {}, { alg: "HS256", key: hs256 })],
      ["issued by another issuer", await h.token(4242, {}, { issuer: "https://evil.test" })],
      ["for another audience", await h.token(4242, {}, { audience: "another-app" })],
      ["for a non-numeric subject", await h.token("someone@example.test")],
    ];
    const results: string[] = [];
    for (const [problem, token] of cases) {
      const res = await h.call("POST", "/api/v1/rooms", { body: { title: "Must not exist" }, ...(token ? { token } : {}) });
      results.push(`${problem}: ${res.status} ${(res.json as { error: { code: string } }).error.code}`);
    }
    expect(results).toEqual([
      "absent: 401 auth.missing_token",
      "not a JWT: 401 auth.invalid_token",
      "expired: 401 auth.invalid_token",
      "signed by a key not in the JWKS: 401 auth.invalid_token",
      "signed with HS256: 401 auth.invalid_token",
      "issued by another issuer: 401 auth.invalid_token",
      "for another audience: 401 auth.invalid_token",
      "for a non-numeric subject: 401 auth.invalid_token",
    ]);
    expect(await h.sql("select count(*)::int as n from rooms")).toEqual([{ n: 0 }]);
  });

  // @ac 006/AC-003
  it("answers 503 when the JWKS does not answer, and never lets the call through", async () => {
    expect(served("GET", "/api/v1/rooms"), "GET /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const hang = await listen(() => {});
    servers.push(hang.server);
    process.env.SOCIAL_JWKS_URL = `${hang.url}/jwks`;
    (await import("./server/config")).resetConfig();
    const started = Date.now();
    const res = await h.call("GET", "/api/v1/rooms", { token: await h.token(4242) });
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ error: { code: "auth.unavailable" } });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // @ac 006/AC-003
  it("reuses fetched keys and refetches for an unknown kid", async () => {
    expect(served("GET", "/api/v1/rooms"), "GET /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const a = await generateKeyPair("RS256", { extractable: true });
    const b = await generateKeyPair("RS256", { extractable: true });
    const keys = [{ ...(await exportJWK(a.publicKey)), kid: "rot-a", alg: "RS256", use: "sig" }];
    let fetches = 0;
    const jwks = await listen((_req, res) => {
      fetches++;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys }));
    });
    servers.push(jwks.server);
    process.env.SOCIAL_JWKS_URL = `${jwks.url}/jwks`;
    (await import("./server/config")).resetConfig();
    const signWith = (key: CryptoKey, kid: string) =>
      new SignJWT({ name: "Test Learner" })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(process.env.SOCIAL_TOKEN_ISSUER!)
        .setAudience("sefaria-social")
        .setSubject("4242")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(key);

    expect((await h.call("GET", "/api/v1/rooms", { token: await signWith(a.privateKey, "rot-a") })).status).toBe(200);
    expect((await h.call("GET", "/api/v1/rooms", { token: await signWith(a.privateKey, "rot-a") })).status).toBe(200);
    expect(fetches).toBe(1);

    // Django rotates: the new key is appended to the JWKS. After the 30 s cooldown a token with its kid triggers a refetch.
    keys.push({ ...(await exportJWK(b.publicKey)), kid: "rot-b", alg: "RS256", use: "sig" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    const rotated = await signWith(b.privateKey, "rot-b");
    expect((await h.call("GET", "/api/v1/rooms", { token: rotated })).status).toBe(200);
    expect(fetches).toBe(2);
  });

  // @ac 006/AC-005
  it("refuses to define a public endpoint that is not on the public list", async () => {
    const modules = import.meta.glob("./server/http/endpoint.ts");
    expect(Object.keys(modules), "the endpoint wrapper").toEqual(["./server/http/endpoint.ts"]);
    const { defineEndpoint } = (await modules["./server/http/endpoint.ts"]!()) as typeof import("./server/http/endpoint");
    const define = () =>
      defineEndpoint({
        operationId: "leakRooms",
        method: "GET",
        path: "/api/v1/everything",
        summary: "Should never be public",
        tags: ["test"],
        access: "public",
        responses: { 200: { description: "x" } },
      });
    expect(define).toThrow("Endpoint leakRooms (GET /api/v1/everything) is declared public but is not on PUBLIC_ENDPOINTS");
    expect(
      defineEndpoint({
        operationId: "getHealth",
        method: "GET",
        path: "/api/v1/health",
        summary: "listed",
        tags: ["ops"],
        access: "public",
        responses: { 200: { description: "x" } },
      }).access,
    ).toBe("public");
  });
});
