/**
 * Who is connecting (plan 6.1): the Sefaria identity token Django issues, verified against Django's JWKS. The relay can verify a
 * token and never mint one. The token travels in `Sec-WebSocket-Protocol` (the only header a browser lets a page set on a
 * WebSocket), never in the URL, where it would land in logs.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

/** The subprotocol a client offers and an accepted socket answers with. */
export const SUBPROTOCOL = "sefaria-social.v1";
const BEARER = "bearer.";
export const AUDIENCE = "sefaria-social";

export interface Identity {
  /** The Sefaria user id (`auth_user.id`), as the token's `sub`. */
  userId: string;
  name: string;
}

export interface AuthEnv {
  JWKS_URL?: string;
  TOKEN_ISSUER?: string;
}

/** The token offered in `Sec-WebSocket-Protocol`, or null when the header lacks our subprotocol or a bearer entry. */
export function tokenFromProtocols(header: string | null): string | null {
  if (!header) return null;
  const offered = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!offered.includes(SUBPROTOCOL)) return null;
  const bearer = offered.find((p) => p.startsWith(BEARER));
  const token = bearer?.slice(BEARER.length) ?? "";
  return token.length > 0 ? token : null;
}

// One remote key set per JWKS URL and isolate; jose caches keys and refetches on an unknown `kid` (key rotation).
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The verified identity, or null for any token that fails (signature, algorithm, issuer, audience, expiry, claims). */
export async function verifyToken(token: string, env: AuthEnv): Promise<Identity | null> {
  if (!env.JWKS_URL || !env.TOKEN_ISSUER) return null; // not configured: fail closed
  let keys = keySets.get(env.JWKS_URL);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(env.JWKS_URL), { timeoutDuration: 5_000, cacheMaxAge: 10 * 60_000 });
    keySets.set(env.JWKS_URL, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      issuer: env.TOKEN_ISSUER,
      audience: AUDIENCE,
      clockTolerance: 30,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (typeof payload.sub !== "string" || !/^[1-9][0-9]{0,18}$/.test(payload.sub)) return null;
    // Spec 064: a token issued through the MCP connector (`via`) may only save Claude assets on the server, never join a room.
    if ("via" in payload) return null;
    const name = typeof payload.name === "string" ? payload.name.slice(0, 200) : "";
    return { userId: payload.sub, name };
  } catch {
    return null;
  }
}

/** Identity crosses from the Worker to the room object in these headers; the Worker always overwrites them. */
export const IDENTITY_HEADERS = { user: "X-Relay-User", name: "X-Relay-Name" } as const;

export function identityHeaders(identity: Identity): Record<string, string> {
  return { [IDENTITY_HEADERS.user]: identity.userId, [IDENTITY_HEADERS.name]: encodeURIComponent(identity.name) };
}

export function identityFrom(headers: Headers): Identity | null {
  const userId = headers.get(IDENTITY_HEADERS.user);
  if (!userId) return null;
  return { userId, name: decodeURIComponent(headers.get(IDENTITY_HEADERS.name) ?? "") };
}
