/**
 * Broadcast tickets (design session-recording-and-broadcast 6.2; spec 043 AC-003). The social server signs one per user and
 * broadcast with RELAY_INTERNAL_SECRET; the relay only verifies. Format, shared with the server byte for byte:
 * `base64url(utf8 JSON {"b","sub","role","exp"}) + "." + base64url(HMAC-SHA256(secret, first segment as ASCII))`, no padding.
 * It travels in `Sec-WebSocket-Protocol` as `ticket.<ticket>`, beside the identity token.
 */

export const TICKET_PREFIX = "ticket.";

export type BroadcastRole = "host" | "viewer";
/** Spec 048: an ordinary room's ticket names its owner (who leads) or a member (who follows). */
export type RoomRole = "owner" | "member";
export type TicketRole = BroadcastRole | RoomRole;

export interface Ticket {
  /** The broadcast id (the relay room is `b_<b>`), or an ordinary room's id. */
  b: string;
  /** The Sefaria user id the ticket was issued to. */
  sub: string;
  role: TicketRole;
  /** Expiry, Unix seconds. */
  exp: number;
}

/** The ticket offered in `Sec-WebSocket-Protocol`, or null when there is no non-empty `ticket.` entry. */
export function ticketFromProtocols(header: string | null): string | null {
  if (!header) return null;
  const entry = header
    .split(",")
    .map((s) => s.trim())
    .find((p) => p.startsWith(TICKET_PREFIX));
  const ticket = entry?.slice(TICKET_PREFIX.length) ?? "";
  return ticket.length > 0 ? ticket : null;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const B64URL = /^[A-Za-z0-9_-]+$/;
/** A ticket is a few hundred bytes; anything far larger is not one. */
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

/** Signs a ticket (the server's job; here for tests). */
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
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(body));
  if (!ok) return null;
  const raw = fromBase64url(body);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(dec.decode(raw));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { b, sub, role, exp } = value as Record<string, unknown>;
  if (typeof b !== "string" || b.length === 0 || typeof sub !== "string" || sub.length === 0) return null;
  if (role !== "host" && role !== "viewer" && role !== "owner" && role !== "member") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= nowSeconds) return null;
  return { b, sub, role, exp };
}
