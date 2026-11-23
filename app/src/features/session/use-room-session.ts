import { useEffect, useSyncExternalStore } from "react";
import type { SessionState } from "@sefaria-social/session";
import { useHost } from "~/features/host/host-context";
import { roomSessionsFor, type Hold, type RoomSession } from "./sessions";

const noop = () => () => undefined;

/** Holds the room's session open while the component is mounted (signed out or standalone: nothing). */
export function useRoomHold(roomId: string | null, hold: Hold, enabled = true): void {
  const host = useHost();
  useEffect(() => {
    if (!host || !roomId || !enabled) return;
    return roomSessionsFor(host).acquire(roomId, hold);
  }, [host, roomId, hold, enabled]);
}

/** The room's session, or null when none is open. */
export function useRoomSession(roomId: string | null): RoomSession | null {
  const host = useHost();
  const sessions = host ? roomSessionsFor(host) : null;
  return useSyncExternalStore(
    sessions ? (cb) => sessions.subscribe(cb) : noop,
    () => (sessions && roomId ? sessions.get(roomId) : null),
    () => null,
  );
}

/** The session client's state, re-rendering on every change (null without a session). */
export function useSessionState(session: RoomSession | null): SessionState | null {
  return useSyncExternalStore(
    session ? (cb) => session.client.subscribe(cb) : noop,
    () => session?.client.getState() ?? null,
    () => null,
  );
}
