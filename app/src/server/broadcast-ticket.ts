// Broadcast tickets (spec 043 AC-002; design docs/design/session-recording-and-broadcast.md §6.2). The server signs one per user
// and broadcast with RELAY_INTERNAL_SECRET; the relay verifies it (packages/relay/src/ticket.ts, the same code shape) before it
// lets a socket into the broadcast's room `b_<id>`, and takes the role from it. The format, byte for byte on both sides:
//   base64url(utf8 JSON {"b","sub","role","exp"}) + "." + base64url(HMAC-SHA256(secret, the first segment as ASCII)), no padding.
// Web Crypto only, so the code runs unchanged in a Worker. A ticket is a bearer credential for 10 minutes: never log it.

export type BroadcastRole = "host" | "viewer";

export interface Ticket {
  /** The broadcast id (the relay room is `b_<b>`). */
  b: string;
  /** The Sefaria user id the ticket was issued to, as a string. */
  sub: string;
  role: BroadcastRole;
  /** Expiry, Unix seconds. */
  exp: number;
}

/** How long a ticket is valid: the relay checks it only when a socket connects. */
export const TICKET_TTL_SECONDS = 600;

/** The relay room of a broadcast: `b_` and the broadcast's uuid, hyphens kept. */
export const relayRoomOf = (broadcastId: string) => `b_${broadcastId}`;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TICKET_LENGTH = 2048;

function toBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(text) || text.length % 4 === 1) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Sign a ticket. The claims are written in the fixed order b, sub, role, exp. */
export async function signTicket(payload: Ticket, secret: string): Promise<string> {
  const body = toBase64url(enc.encode(JSON.stringify({ b: payload.b, sub: payload.sub, role: payload.role, exp: payload.exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(body)));
  return `${body}.${toBase64url(sig)}`;
}

/** The ticket's claims, or null for a missing secret, a malformed or tampered ticket, wrong claim types, or `exp <= now`. */
export async function verifyTicket(ticket: string, secret: string | undefined, nowSeconds: number): Promise<Ticket | null> {
  if (!secret || ticket.length > MAX_TICKET_LENGTH) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, sigText] = parts as [string, string];
  const sig = fromBase64url(sigText);
  if (!sig || !B64URL.test(body)) return null;
  // verify() compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(body)))) return null;
  const raw = fromBase64url(body);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(dec.decode(raw));
  } catch {
    return null;
  }
  const t = value as Partial<Record<keyof Ticket, unknown>> | null;
  if (typeof t !== "object" || t === null) return null;
  if (typeof t.b !== "string" || typeof t.sub !== "string" || typeof t.exp !== "number") return null;
  if (t.role !== "host" && t.role !== "viewer") return null;
  if (!Number.isFinite(t.exp) || t.exp <= nowSeconds) return null;
  return { b: t.b, sub: t.sub, role: t.role, exp: t.exp };
}
