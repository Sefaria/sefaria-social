// Runs the relay in workerd for tests (decision 0007): bundle src/worker.ts with esbuild, start it with Miniflare, and talk to
// it with real WebSockets through dispatchFetch. Tokens are RS256, signed by a key generated per run, whose JWKS a local HTTP
// server publishes, exactly as Django's JWKS endpoint does.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey as JoseKey } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGIN = "https://www.sefaria.org";
export const ISSUER = "https://www.sefaria.org";
export const SECRET = "relay-internal-test-secret";
export const KID = "relay-test";

export async function bundleWorker(): Promise<string> {
  const out = await build({
    entryPoints: [path.join(here, "..", "src", "worker.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["cloudflare:workers"],
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0]!.text;
}

export interface Relay {
  mf: Miniflare;
  /** Signs a Sefaria-style identity token (plan 6.1) with the test key, or with `key` (a key the JWKS does not hold). */
  token(claims: { sub: string; name?: string; expSeconds?: number; iss?: string; aud?: string }, key?: JoseKey): Promise<string>;
  otherKey: JoseKey;
  close(): Promise<void>;
}

export async function startRelay(): Promise<Relay> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  const jwks: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
  const jwksUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/.well-known/sefaria-social-jwks.json`;

  // Miniflare 5 (the version wrangler 4.166 runs) takes a new options shape; the documented converter accepts the v4 shape.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await bundleWorker(),
      compatibilityDate: "2026-10-01",
      durableObjects: { ROOMS: "Room" },
      bindings: { ALLOWED_ORIGINS: ORIGIN, JWKS_URL: jwksUrl, TOKEN_ISSUER: ISSUER, RELAY_INTERNAL_SECRET: SECRET },
    }),
  );
  await mf.ready;

  return {
    mf,
    otherKey: other.privateKey,
    async token({ sub, name = "Test Learner", expSeconds = 600, iss = ISSUER, aud = "sefaria-social" }, key = privateKey) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ name, staff: false })
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
        .setIssuer(iss)
        .setAudience(aud)
        .setSubject(sub)
        .setIssuedAt(now)
        .setExpirationTime(now + expSeconds)
        .setJti(crypto.randomUUID())
        .sign(key);
    },
    async close() {
      await mf.dispose();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
    },
  };
}

type MfResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;
type MfSocket = NonNullable<MfResponse["webSocket"]>;

/** An open socket to a room, collecting every envelope it receives. */
export interface Peer {
  status: number;
  protocol: string | null;
  socket: MfSocket | null;
  received: unknown[];
  closed: boolean;
  send(envelope: unknown): void;
}

export async function connect(
  mf: Miniflare,
  roomPath: string,
  opts: { origin?: string | null; protocols?: string[] } = {},
): Promise<Peer> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.protocols) headers["Sec-WebSocket-Protocol"] = opts.protocols.join(", ");
  const res = await mf.dispatchFetch(`http://relay.test${roomPath}`, { headers });
  const peer: Peer = {
    status: res.status,
    protocol: res.headers.get("Sec-WebSocket-Protocol"),
    socket: res.webSocket ?? null,
    received: [],
    closed: false,
    send(envelope) {
      peer.socket?.send(JSON.stringify(envelope));
    },
  };
  if (peer.socket) {
    peer.socket.accept();
    peer.socket.addEventListener("message", (e) => peer.received.push(JSON.parse(String(e.data))));
    peer.socket.addEventListener("close", () => (peer.closed = true));
  } else {
    await res.arrayBuffer();
  }
  return peer;
}

export const join = (id: string, name = "claimed") => ({
  ch: "control",
  body: { type: "join", participant: { id, name, isHost: true, canLead: true } },
});

/** The last participants list a peer received. */
export function lastParticipants(peer: Peer): { id: string; name?: string }[] | undefined {
  const lists = peer.received.filter(
    (m): m is { ch: "presence"; body: { type: "participants"; participants: { id: string; name?: string }[] } } =>
      typeof m === "object" && m !== null && (m as { ch?: string }).ch === "presence",
  );
  return lists.at(-1)?.body.participants;
}
