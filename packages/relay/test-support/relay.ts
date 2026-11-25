// Runs the relay in workerd for tests (decision 0007): bundle src/worker.ts with esbuild, start it with Miniflare, and talk to
// it with real WebSockets through dispatchFetch. Tokens are RS256, signed by a key generated per run, whose JWKS a local HTTP
// server publishes, exactly as Django's JWKS endpoint does.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHmac } from "node:crypto";
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
  /** The relay's HTTP address (workerd listening on a local port), for callers outside the test process's dispatchFetch. */
  url: URL;
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
      durableObjects: { ROOMS: "Room", TOMBSTONES: "Tombstones" },
      bindings: { ALLOWED_ORIGINS: ORIGIN, JWKS_URL: jwksUrl, TOKEN_ISSUER: ISSUER, RELAY_INTERNAL_SECRET: SECRET },
    }),
  );
  const url = await mf.ready;

  return {
    mf,
    url,
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

/** An owner ticket for `room` and `sub`, signed as the social server signs it (spec 048). */
export function ownerTicket(room: string, sub: string, expSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const body = Buffer.from(JSON.stringify({ b: room, sub, role: "owner", exp })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body, "ascii").digest("base64url")}`;
}

/** The `sub` of the bearer token among the protocols, read without verifying (the relay verifies). */
function subOf(protocols: string[]): string | null {
  const token = protocols.find((p) => p.startsWith("bearer."))?.slice("bearer.".length);
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Opens a socket to `roomPath`. In an ordinary room only an owner ticket makes a leader (spec 048); tests written before that
 * joined as leaders, so a connection with a bearer token and no ticket offers an owner ticket for the token's user, the way
 * a room's owner connects. `owner: false` connects without one (a member).
 */
export async function connect(
  mf: Miniflare,
  roomPath: string,
  opts: { origin?: string | null; protocols?: string[]; owner?: boolean } = {},
): Promise<Peer> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  let protocols = opts.protocols;
  const room = /^\/r\/([^/]+)$/.exec(roomPath)?.[1];
  if (protocols && room && !room.startsWith("b_") && opts.owner !== false && !protocols.some((p) => p.startsWith("ticket."))) {
    const sub = subOf(protocols);
    if (sub) protocols = [...protocols, `ticket.${ownerTicket(decodeURIComponent(room), sub)}`];
  }
  if (protocols) headers["Sec-WebSocket-Protocol"] = protocols.join(", ");
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

/**
 * The last participants list a peer received, ordered by id. The room lists people in the order their joins arrived, and joins
 * sent from two sockets one after the other may arrive either way round; ordering here keeps the tests about who, not when.
 */
export function lastParticipants(peer: Peer): { id: string; name?: string }[] | undefined {
  const lists = peer.received.filter(
    (m): m is { ch: "presence"; body: { type: "participants"; participants: { id: string; name?: string }[] } } =>
      typeof m === "object" && m !== null && (m as { ch?: string }).ch === "presence",
  );
  const last = lists.at(-1)?.body.participants;
  return last ? [...last].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : undefined;
}
