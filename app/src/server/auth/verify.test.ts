// Token verification against a local JWKS server (unit level; the acceptance tests run the same through the API).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { ApiError } from "../http/errors";
import { setLogSink } from "../log/logger";
import { resetKeySets, verifyToken, type VerifyOptions } from "./verify";

const ISSUER = "https://sefaria.test";
let server: Server;
let base: string;
let fetches = 0;
let published: JWK[] = [];
let keyA: CryptoKey;
let keyB: CryptoKey;

const sign = (key: CryptoKey, kid: string, sub = "4242", mutate: (j: SignJWT) => SignJWT = (j) => j) =>
  mutate(
    new SignJWT({ name: " Test Learner ", staff: true })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(ISSUER)
      .setAudience("sefaria-social")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("10m"),
  ).sign(key);

const opts = (path = "/jwks"): VerifyOptions => ({ jwksUrl: `${base}${path}`, issuer: ISSUER, audience: "sefaria-social" });

const code = (p: Promise<unknown>) =>
  p.then(
    () => "accepted",
    (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)),
  );

beforeAll(async () => {
  const a = await generateKeyPair("RS256", { extractable: true });
  const b = await generateKeyPair("RS256", { extractable: true });
  keyA = a.privateKey;
  keyB = b.privateKey;
  const jwkA = { ...(await exportJWK(a.publicKey)), kid: "a", alg: "RS256", use: "sig" };
  const jwkB = { ...(await exportJWK(b.publicKey)), kid: "b", alg: "RS256", use: "sig" };
  published = [jwkA];
  server = createServer((req, res) => {
    if (req.url === "/hang") return; // never answers
    fetches++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: req.url === "/both" ? [jwkA, jwkB] : published }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setLogSink(() => {});
});

afterAll(async () => {
  setLogSink(null);
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  resetKeySets();
  fetches = 0;
});

describe("verifyToken", () => {
  it("returns the identity from a valid token", async () => {
    await expect(verifyToken(await sign(keyA, "a"), opts())).resolves.toEqual({
      userId: 4242,
      name: "Test Learner",
      picture: null,
      staff: true,
    });
  });

  it("reuses fetched keys", async () => {
    await verifyToken(await sign(keyA, "a"), opts());
    await verifyToken(await sign(keyA, "a"), opts());
    expect(fetches).toBe(1);
  });

  it("refuses a key that is not published", async () => {
    expect(await code(verifyToken(await sign(keyB, "b"), opts()))).toBe("401 auth.invalid_token");
  });

  it("refuses a token signed by another key under a published kid", async () => {
    expect(await code(verifyToken(await sign(keyB, "a"), opts()))).toBe("401 auth.invalid_token");
  });

  it.each([
    ["wrong issuer", (j: SignJWT) => j.setIssuer("https://evil.test")],
    ["wrong audience", (j: SignJWT) => j.setAudience("someone-else")],
    ["expired", (j: SignJWT) => j.setExpirationTime(Math.floor(Date.now() / 1000) - 120)],
  ])("refuses a token with the %s", async (_c, mutate) => {
    expect(await code(verifyToken(await sign(keyA, "a", "4242", mutate), opts()))).toBe("401 auth.invalid_token");
  });

  it.each(["abc", "0", "-1", "12.5", "99999999999999999"])("refuses sub %s", async (sub) => {
    expect(await code(verifyToken(await sign(keyA, "a", sub), opts()))).toBe("401 auth.invalid_token");
  });

  it("refuses HS256 even with a published kid", async () => {
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "a" })
      .setIssuer(ISSUER)
      .setAudience("sefaria-social")
      .setSubject("4242")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!"));
    expect(await code(verifyToken(hs, opts()))).toBe("401 auth.invalid_token");
  });

  it("refuses something that is not a JWT", async () => {
    expect(await code(verifyToken("not.a.jwt", opts()))).toBe("401 auth.invalid_token");
  });

  it("is unavailable, not open, when the JWKS does not answer in time", async () => {
    const started = Date.now();
    expect(await code(verifyToken(await sign(keyA, "a"), opts("/hang")))).toBe("503 auth.unavailable");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("is unavailable when nothing listens at the JWKS URL", async () => {
    const o = { ...opts(), jwksUrl: "http://127.0.0.1:1/jwks" };
    expect(await code(verifyToken(await sign(keyA, "a"), o))).toBe("503 auth.unavailable");
  });

  it("is unavailable when not configured", async () => {
    expect(await code(verifyToken(await sign(keyA, "a"), null))).toBe("503 auth.unavailable");
  });

  it("accepts a key from a JWKS with several keys (rotation)", async () => {
    await expect(verifyToken(await sign(keyB, "b"), opts("/both"))).resolves.toMatchObject({ userId: 4242 });
  });
});
