// One connection per joined room (plan 4.5: a socket opens only for a room the viewer is in — its lobby, its reader context,
// or a live session they entered — never for a card that nobody has pressed). Holds are reference counts: the lobby holds while it is open, the
// persistent mount while a social ctx is in the address, and "live" from entering until the viewer leaves. The last release
// closes the socket. Every connection asks the host for a fresh identity token, which travels in Sec-WebSocket-Protocol.
import {
  createSessionClient,
  createWebSocketTransport,
  type AnyEnvelope,
  type SessionClient,
  type StateTransport,
} from "@sefaria-social/session";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { pageTextSource } from "~/lib/sefaria-text";
import { drifted } from "./place";
import { roomReader, type RoomReader } from "./room-reader";
import { documentHostFor } from "~/features/host/document-host";
import { roomsApiFor, type RoomTicket } from "~/features/api/rooms-api";

export const RELAY_SUBPROTOCOL = "sefaria-social.v1";
/** "prefetch": a press on a feed card prepares the room before the click lands (spec 017 AC-004). "call": the viewer is in
 * the room's call, which keeps the room connected wherever they read (spec 034, AV1). */
export type Hold = "lobby" | "context" | "live" | "prefetch" | "call" | "broadcast";

/**
 * A connection that is not a plain room's (a broadcast's relay room, spec 043): extra subprotocols offered after the bearer
 * token (`ticket.<ticket>`, asked for at every connect so a reconnect carries a fresh one), and its own gates in place of the
 * room controller's policy. Read when the connection opens; a later acquire of an open connection ignores it.
 */
export interface ConnectionOptions {
  extraProtocols?: () => Promise<string[]>;
  /** Publish this reader's stream? (replaces `SessionPolicy.canPublish` for this connection) */
  canPublish?: () => boolean;
  /** Apply what arrives? (replaces `SessionPolicy.isOpen` for this connection) */
  isOpen?: () => boolean;
  /** How this person joins (a broadcast's viewer never leads). Default: host and may lead. */
  role?: { isHost: boolean; canLead: boolean };
}

export interface RoomSession {
  roomId: string;
  client: SessionClient;
  reader: RoomReader;
  holds: ReadonlySet<Hold>;
}

/** What the controller decides for each room: apply what arrives? publish our own stream? */
export interface SessionPolicy {
  isOpen(roomId: string): boolean;
  canPublish(roomId: string): boolean;
}

export interface RoomSessions {
  /** Hold a room's session open; returns the release. Signed out or no relay: nothing opens and the release does nothing. */
  acquire(roomId: string, hold: Hold, opts?: ConnectionOptions): () => void;
  get(roomId: string): RoomSession | null;
  /** Rooms with a session, for the mini view. */
  rooms(): string[];
  /** Fires when a session opens or closes or its holds change. */
  subscribe(cb: () => void): () => void;
  setPolicy(policy: SessionPolicy): void;
  /** Re-read the policy: publish or not, and apply what was held if the gate opened. */
  refresh(): void;
}

/** `<relayOrigin>/r/<roomId>`, as a WebSocket URL (an http(s) relay origin becomes ws(s)). */
export function relayUrl(relayOrigin: string, roomId: string): string {
  const base = relayOrigin.replace(/^http(s?):\/\//, "ws$1://").replace(/\/+$/, "");
  return `${base}/r/${encodeURIComponent(roomId)}`;
}

export type TransportFactory = (url: string, protocols: () => Promise<string[]>) => StateTransport<AnyEnvelope>;

const defaultTransport: TransportFactory = (url, protocols) => createWebSocketTransport<AnyEnvelope>(url, { protocols });

const CLOSED: SessionPolicy = { isOpen: () => false, canPublish: () => false };
/** A held room ticket is replaced when it has less than this left (it is checked only when a socket connects). */
const TICKET_MARGIN_MS = 60_000;

export function createRoomSessions(host: SurfaceHost, makeTransport: TransportFactory = defaultTransport): RoomSessions {
  /** `next`: the session that replaced this ended one (spec 050); holds taken on this one count on it. */
  type Entry = RoomSession & { holds: Set<Hold>; counts: Map<Hold, number>; next?: Entry };
  const sessions = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let policy = CLOSED;
  const emit = () => [...listeners].forEach((cb) => cb());

  function open(roomId: string, opts: ConnectionOptions = {}) {
    const viewer = host.viewer.get();
    // Signed out, or a reader with no relay configured (it sends relayOrigin ""): no socket, the same as signed out.
    if (!viewer || !host.config.relayOrigin) return null;
    const extra = opts.extraProtocols ?? roomTickets(roomId);
    const transport = makeTransport(relayUrl(host.config.relayOrigin, roomId), async () => [
      RELAY_SUBPROTOCOL,
      `bearer.${await host.viewer.identityToken()}`,
      ...(await extra()),
    ]);
    const reader = roomReader(host.reader.state, {
      isOpen: opts.isOpen ?? (() => policy.isOpen(roomId)),
      commands: host.reader.commands,
      titles: pageTextSource(),
    });
    // The relay replaces id and name with the token's; sending the same values keeps the client's idea of "self" right. The
    // flags are a claim the relay overwrites from the room ticket: only the owner's ticket makes a leader (spec 048 AC-005).
    const self = { id: String(viewer.id), name: viewer.name, ...(opts.role ?? { isHost: true, canLead: true }) };
    const client = createSessionClient({
      api: reader.api,
      transport,
      self,
      clientName: "sefaria-social",
      canPublish: opts.canPublish ?? (() => policy.canPublish(roomId)),
      // Spec 048: in a room a follower breaks away only by a clear move, never by a click (features/session/place.ts). A
      // broadcast's viewer (relay room `b_<id>`) still breaks away on any input, with Back to live (spec 043).
      ...(roomId.startsWith("b_") ? {} : { drifted }),
    });
    const s = { roomId, client, reader, holds: new Set<Hold>(), counts: new Map<Hold, number>() };
    sessions.set(roomId, s);
    return s;
  }

  /**
   * The room's relay ticket, offered at every connect (spec 048): asked for again a minute before it expires. Without one (not
   * a member, the API unreachable) the socket connects without it and the relay makes this person a member.
   */
  function roomTickets(roomId: string): () => Promise<string[]> {
    let held: RoomTicket | null = null;
    return async () => {
      if (!held || Date.parse(held.expiresAt) - Date.now() < TICKET_MARGIN_MS) {
        held = await (roomsApiFor(host).ticket?.(roomId) ?? Promise.resolve(null)).catch(() => null);
      }
      return held ? [`ticket.${held.ticket}`] : [];
    };
  }

  return {
    acquire(roomId, hold, opts) {
      // A session that ended (the room was closed, spec 050) is not joined again: a new connection may start a new session.
      // Holds taken on the ended one move to the new one, so a lobby still open keeps it alive.
      const old = sessions.get(roomId);
      let s: Entry | null;
      if (old && old.client.getState().status === "ended") {
        sessions.delete(roomId);
        s = open(roomId, opts);
        if (s) {
          for (const [h, n] of old.counts) s.counts.set(h, (s.counts.get(h) ?? 0) + n);
          for (const h of old.holds) s.holds.add(h);
          old.next = s;
        }
      } else s = old ?? open(roomId, opts);
      if (!s) return () => undefined;
      const taken = s;
      s.counts.set(hold, (s.counts.get(hold) ?? 0) + 1);
      s.holds.add(hold);
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        let s = taken;
        while (s.next) s = s.next;
        const n = (s.counts.get(hold) ?? 1) - 1;
        if (n > 0) s.counts.set(hold, n);
        else {
          s.counts.delete(hold);
          s.holds.delete(hold);
        }
        if (s.holds.size === 0 && sessions.get(roomId) === s) {
          sessions.delete(roomId);
          s.client.stop();
        }
        emit();
      };
    },
    get: (roomId) => sessions.get(roomId) ?? null,
    rooms: () => [...sessions.keys()],
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setPolicy(next) {
      policy = next;
    },
    refresh() {
      for (const s of sessions.values()) {
        s.client.refresh();
        void s.reader.release();
      }
    },
  };
}

const perHost = new WeakMap<SurfaceHost, RoomSessions>();

/** The one RoomSessions of this host, shared by the page mount and the persistent mount (same module, same document). */
export function roomSessionsFor(rawHost: SurfaceHost): RoomSessions {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let s = perHost.get(host);
  if (!s) {
    s = createRoomSessions(host);
    perHost.set(host, s);
  }
  return s;
}
