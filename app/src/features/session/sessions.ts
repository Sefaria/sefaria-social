// One connection per joined room (plan 4.5: a socket opens only for a room the viewer is in — its lobby, its reader context,
// or a live session they entered — never for a card). Holds are reference counts: the lobby holds while it is open, the
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
import { roomReader, type RoomReader } from "./room-reader";

export const RELAY_SUBPROTOCOL = "sefaria-social.v1";
export type Hold = "lobby" | "context" | "live";

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
  /** Hold a room's session open; returns the release. Signed out: nothing opens and the release does nothing. */
  acquire(roomId: string, hold: Hold): () => void;
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

export function createRoomSessions(host: SurfaceHost, makeTransport: TransportFactory = defaultTransport): RoomSessions {
  const sessions = new Map<string, RoomSession & { holds: Set<Hold>; counts: Map<Hold, number> }>();
  const listeners = new Set<() => void>();
  let policy = CLOSED;
  const emit = () => [...listeners].forEach((cb) => cb());

  function open(roomId: string) {
    const viewer = host.viewer.get();
    if (!viewer) return null;
    const transport = makeTransport(relayUrl(host.config.relayOrigin, roomId), async () => [
      RELAY_SUBPROTOCOL,
      `bearer.${await host.viewer.identityToken()}`,
    ]);
    const reader = roomReader(host.reader.state, { isOpen: () => policy.isOpen(roomId), commands: host.reader.commands });
    // The relay replaces id and name with the token's; sending the same values keeps the client's idea of "self" right.
    // Everyone may lead (the relay cannot see room roles yet; decision 0008).
    const self = { id: String(viewer.id), name: viewer.name, isHost: true, canLead: true };
    const client = createSessionClient({
      api: reader.api,
      transport,
      self,
      clientName: "sefaria-social",
      canPublish: () => policy.canPublish(roomId),
    });
    const s = { roomId, client, reader, holds: new Set<Hold>(), counts: new Map<Hold, number>() };
    sessions.set(roomId, s);
    return s;
  }

  return {
    acquire(roomId, hold) {
      const s = sessions.get(roomId) ?? open(roomId);
      if (!s) return () => undefined;
      s.counts.set(hold, (s.counts.get(hold) ?? 0) + 1);
      s.holds.add(hold);
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
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
export function roomSessionsFor(host: SurfaceHost): RoomSessions {
  let s = perHost.get(host);
  if (!s) {
    s = createRoomSessions(host);
    perHost.set(host, s);
  }
  return s;
}
