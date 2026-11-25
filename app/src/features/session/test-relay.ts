// Test support: an in-process stand-in for the relay (packages/relay) behind a fake global WebSocket, for component tests of
// the surface. It runs the real room from @sefaria-social/session and mirrors the relay's own rules where the surface can
// see them: the token must be offered in Sec-WebSocket-Protocol as "bearer.<token>" next to "sefaria-social.v1" (else the
// socket closes before opening), and the token's sub and name replace whatever a join claims. Not used in production code.
import { createRoom, type Room } from "@sefaria-social/session";

interface Conn {
  id: string;
  room: string;
  deliver: (text: string) => void;
  close: () => void;
}

export interface TestPeer {
  received: unknown[];
  send(envelope: unknown): void;
  leave(): void;
}

export interface TestRelay {
  /** Every socket the surface opened: its URL and the subprotocols it offered. */
  opened: { url: string; protocols: string[] }[];
  /** Sockets currently open, by room id. */
  open(roomId: string): number;
  /** Another participant, driven by the test from inside the relay. `isHost: false` joins as a member (spec 048). */
  peer(roomId: string, userId: string, name: string, opts?: { isHost?: boolean }): TestPeer;
  /** Drop every surface socket of a room (a network blip). With `refuse`, reconnects are refused until `allow()`. */
  drop(roomId: string, opts?: { refuse?: boolean }): void;
  allow(): void;
  room(roomId: string): Room;
  restore(): void;
}

function claims(token: string): { sub: string; name: string } | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: unknown;
      name?: unknown;
    };
    return typeof payload.sub === "string"
      ? { sub: payload.sub, name: typeof payload.name === "string" ? payload.name : "" }
      : null;
  } catch {
    return null;
  }
}

/**
 * `owners`: the user ids the real relay would make hosts from their owner tickets (spec 048 AC-005); every other surface join
 * is a member. Without it, a surface join keeps the flags it claims (as tests written before spec 048 expect).
 */
export function installTestRelay(opts: { owners?: string[] } = {}): TestRelay {
  const rooms = new Map<string, Room>();
  const conns = new Map<string, Conn>();
  let next = 1;
  let refusing = false;
  const opened: TestRelay["opened"] = [];
  const later = (fn: () => void) => setTimeout(fn, 0);

  const roomOf = (id: string) => {
    let r = rooms.get(id);
    if (!r) {
      r = createRoom({ now: Date.now });
      rooms.set(id, r);
    }
    return r;
  };
  const deliverAll = (roomId: string, out: ReturnType<Room["handle"]>) => {
    const r = roomOf(roomId);
    for (const o of out) {
      const text = JSON.stringify(o.envelope);
      for (const c of r.recipients(o.to)) conns.get(c)?.deliver(text);
    }
  };
  const rewriteJoin = (text: string, who: { sub: string; name: string }) => {
    const v = JSON.parse(text) as { ch?: string; body?: { type?: string; participant?: object } };
    if (v.ch === "control" && v.body?.type === "join" && v.body.participant)
      v.body.participant = { ...v.body.participant, id: who.sub, name: who.name };
    return JSON.stringify(v);
  };
  /** A surface join, with the flags an owner ticket gives (when `owners` is set). */
  const surfaceJoin = (text: string, who: { sub: string; name: string }) => {
    const rewritten = rewriteJoin(text, who);
    if (!opts.owners) return rewritten;
    const v = JSON.parse(rewritten) as { ch?: string; body?: { type?: string; participant?: object } };
    if (v.ch !== "control" || v.body?.type !== "join" || !v.body.participant) return rewritten;
    const isHost = opts.owners.includes(who.sub);
    v.body.participant = { ...v.body.participant, isHost, canLead: isHost };
    return JSON.stringify(v);
  };

  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private conn: Conn | null = null;
    private who: { sub: string; name: string } | null = null;
    constructor(url: string, protocols?: string | string[]) {
      const offered = typeof protocols === "string" ? [protocols] : (protocols ?? []);
      opened.push({ url, protocols: offered });
      const roomId = decodeURIComponent(new URL(url).pathname.replace(/^\/r\//, ""));
      const bearer = offered.find((p) => p.startsWith("bearer."));
      const who = offered.includes("sefaria-social.v1") && bearer ? claims(bearer.slice("bearer.".length)) : null;
      later(() => {
        if (!who || refusing) {
          this.onclose?.();
          return;
        }
        const id = `c${next++}`;
        const conn: Conn = {
          id,
          room: roomId,
          deliver: (text) => later(() => this.conn === conn && this.onmessage?.({ data: text })),
          close: () => {
            if (this.conn !== conn) return;
            this.conn = null;
            conns.delete(id);
            deliverAll(roomId, roomOf(roomId).disconnect(id));
            later(() => this.onclose?.());
          },
        };
        this.conn = conn;
        conns.set(id, conn);
        roomOf(roomId).connect(id);
        this.who = who;
        this.onopen?.();
      });
    }
    send(text: string) {
      const conn = this.conn;
      const who = this.who;
      if (!conn || !who) return;
      later(() => deliverAll(conn.room, roomOf(conn.room).handle(conn.id, surfaceJoin(text, who))));
    }
    close() {
      this.conn?.close();
    }
  }

  const original = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;

  return {
    opened,
    open: (roomId) => [...conns.values()].filter((c) => c.room === roomId && !c.id.startsWith("peer")).length,
    peer(roomId, userId, name, opts) {
      const id = `peer-${next++}`;
      const received: unknown[] = [];
      conns.set(id, { id, room: roomId, deliver: (t) => received.push(JSON.parse(t)), close: () => undefined });
      roomOf(roomId).connect(id);
      const send = (envelope: unknown) => {
        const text = rewriteJoin(JSON.stringify(envelope), { sub: userId, name });
        deliverAll(roomId, roomOf(roomId).handle(id, text));
      };
      const isHost = opts?.isHost ?? true;
      send({ ch: "control", body: { type: "join", participant: { id: userId, name, isHost, canLead: isHost } } });
      return {
        received,
        send,
        leave() {
          conns.delete(id);
          deliverAll(roomId, roomOf(roomId).disconnect(id));
        },
      };
    },
    drop(roomId, opts) {
      if (opts?.refuse) refusing = true;
      for (const c of [...conns.values()]) if (c.room === roomId && !c.id.startsWith("peer")) c.close();
    },
    allow() {
      refusing = false;
    },
    room: roomOf,
    restore() {
      (globalThis as { WebSocket?: unknown }).WebSocket = original;
    },
  };
}
