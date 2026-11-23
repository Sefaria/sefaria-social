/**
 * The room relay on Cloudflare (plan 1.1, 6.4): the Worker checks the path and the page's Origin, then hands the WebSocket to the
 * Durable Object named after the room id, which runs the pure room from @sefaria-social/session. Started from the reader's
 * relay (reader-next/relay/worker.ts @ 70b0804c9e; decision 0007).
 */
import { DurableObject } from "cloudflare:workers";
import { createRoom, type Outgoing, type Room as PureRoom } from "@sefaria-social/session/room";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  /** Exact origins, comma-separated; "https://*.suffix" allows any subdomain of suffix. */
  ALLOWED_ORIGINS: string;
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
    return env.ROOMS.get(env.ROOMS.idFromName(match[1]!)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

/** One room: the pure room, its sockets, and a once-a-second tick while anyone is connected. */
export class Room extends DurableObject<Env> {
  private room: PureRoom = createRoom({ now: Date.now });
  private sockets = new Map<string, WebSocket>();
  private nextConn = 1;
  private ticker: ReturnType<typeof setInterval> | null = null;

  override async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept(); // the standard API, not acceptWebSocket(): no hibernation, which would discard the in-memory room
    const conn = `ws-${this.nextConn++}`;
    this.sockets.set(conn, server);
    this.room.connect(conn);
    this.ticker ??= setInterval(() => this.deliver(this.room.tick()), 1000);

    server.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return; // the protocol is JSON text; the room checks size and shape
      this.deliver(this.room.handle(conn, e.data));
    });
    const gone = () => {
      if (!this.sockets.delete(conn)) return;
      this.deliver(this.room.disconnect(conn));
      if (this.sockets.size === 0 && this.ticker) {
        clearInterval(this.ticker); // nothing keeps the object now: it shuts down and the room goes with it
        this.ticker = null;
      }
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
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
