/**
 * The room relay on Cloudflare (plan 1.1, 6.4): the Worker checks the path and the page's Origin, then hands the WebSocket to the
 * Durable Object named after the room id, which runs the pure room from @sefaria-social/session. Started from the reader's
 * relay (reader-next/relay/worker.ts @ 70b0804c9e; decision 0007).
 */
import { DurableObject } from "cloudflare:workers";
import { createRoom, LIMITS_FOR_RELAY, type Outgoing, type Room as PureRoom } from "./room";
import { SUBPROTOCOL, identityFrom, identityHeaders, tokenFromProtocols, verifyToken, type Identity } from "./auth";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  /** Exact origins, comma-separated; "https://*.suffix" allows any subdomain of suffix. */
  ALLOWED_ORIGINS: string;
  /** Django's JWKS (`https://<sefaria>/.well-known/sefaria-social-jwks.json`). Unset: every upgrade is refused. */
  JWKS_URL?: string;
  /** Must equal the `iss` Django puts in its tokens. Unset: every upgrade is refused. */
  TOKEN_ISSUER?: string;
}

/** Room ids: routing rule R6's grammar, the same as the reader relay's path rule. */
export const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{8,128})$/;

/** Is this Origin allowed? Rules are exact origins, or "https://*.suffix" for any subdomain of suffix. */
export function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  for (const rule of allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (rule === origin) return true;
    const m = /^(https?):\/\/\*\.(.+)$/.exec(rule);
    if (!m) continue;
    try {
      const u = new URL(origin);
      if (u.protocol === `${m[1]}:` && !u.port && u.hostname.endsWith(`.${m[2]}`)) return true;
    } catch {
      // not a URL: no match
    }
  }
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), env.ALLOWED_ORIGINS)) return new Response("forbidden", { status: 403 });
    // Identity before any room sees the socket (plan 6.1). A token in the URL is never read.
    const token = tokenFromProtocols(req.headers.get("Sec-WebSocket-Protocol"));
    const identity = token ? await verifyToken(token, env) : null;
    if (!identity) return new Response("unauthorized", { status: 401 });
    return forwardToRoom(env, match[1]!, req, identity);
  },
} satisfies ExportedHandler<Env>;

/** Hands the upgrade to the room's object with the verified identity in internal headers (overwriting any the client sent). */
function forwardToRoom(env: Env, roomId: string, req: Request, identity: Identity): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const [k, v] of Object.entries(identityHeaders(identity))) headers.set(k, v);
  return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(new Request(req.url, { headers }));
}

/** One room: the pure room, its sockets, and a once-a-second tick while anyone is connected. */
export class Room extends DurableObject<Env> {
  private room: PureRoom = createRoom({ now: Date.now });
  private sockets = new Map<string, WebSocket>();
  private nextConn = 1;
  private ticker: ReturnType<typeof setInterval> | null = null;

  /** Which user each connection is (from the verified token). */
  private users = new Map<string, Identity>();

  override async fetch(req: Request): Promise<Response> {
    const identity = identityFrom(req.headers);
    if (!identity) return new Response("unauthorized", { status: 401 }); // only the Worker reaches this object, and it always sets one
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept(); // the standard API, not acceptWebSocket(): no hibernation, which would discard the in-memory room
    const conn = `ws-${this.nextConn++}`;
    this.sockets.set(conn, server);
    this.users.set(conn, identity);
    this.room.connect(conn);
    this.ticker ??= setInterval(() => this.deliver(this.room.tick()), 1000);

    server.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return; // the protocol is JSON text; the room checks size and shape
      this.deliver(this.room.handle(conn, withIdentity(e.data, identity)));
    });
    const gone = () => {
      if (!this.sockets.delete(conn)) return;
      this.users.delete(conn);
      this.deliver(this.room.disconnect(conn));
      if (this.sockets.size === 0 && this.ticker) {
        clearInterval(this.ticker); // nothing keeps the object now: it shuts down and the room goes with it
        this.ticker = null;
      }
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": SUBPROTOCOL } });
  }

  private deliver(out: Outgoing[]) {
    for (const { to, envelope } of out) {
      const text = JSON.stringify(envelope);
      for (const id of this.room.recipients(to)) {
        try {
          this.sockets.get(id)?.send(text);
        } catch {
          // a socket closing under us; its close event cleans up
        }
      }
    }
  }
}

/**
 * A `join` names the participant; the token decides who that is (plan 6.1). Every other message, and anything the room would
 * refuse anyway (too large, not JSON), passes through untouched for the room's own checks.
 */
export function withIdentity(text: string, identity: Identity): string {
  if (text.length > LIMITS_FOR_RELAY.maxMessageBytes) return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  const v = value as { ch?: unknown; body?: { type?: unknown; participant?: unknown } };
  if (v?.ch !== "control" || v.body?.type !== "join" || typeof v.body.participant !== "object" || v.body.participant === null)
    return text;
  v.body.participant = { ...(v.body.participant as object), id: identity.userId, name: identity.name };
  return JSON.stringify(v);
}
