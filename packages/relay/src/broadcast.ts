/**
 * Broadcast rooms (design session-recording-and-broadcast 6.2; spec 043 AC-004): the relay's filters for a room whose id starts
 * `b_`. A viewer only watches: of what it sends, the room sees its join, leave, hello and resync; its join is never a host's; and
 * the participants list it receives names the host only (viewers do not see each other). Pure, so they test without workerd.
 */
import { LIMITS_FOR_RELAY, type Outgoing } from "./room";
import type { BroadcastRole } from "./ticket";

export const BROADCAST_ROOM_PREFIX = "b_";

/** The broadcast role crosses from the Worker to the room object in this header; the Worker always sets or removes it. */
export const ROLE_HEADER = "X-Relay-Role";

export const isBroadcastRoom = (roomId: string): boolean => roomId.startsWith(BROADCAST_ROOM_PREFIX);

/** What a viewer may send: channel and body type. */
const VIEWER_ALLOWED = new Set(["control.join", "control.leave", "state.hello", "state.resync"]);

function parse(text: string): { ch?: unknown; body?: { type?: unknown; participant?: unknown } } | null {
  if (text.length > LIMITS_FOR_RELAY.maxMessageBytes) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as ReturnType<typeof parse>) : null;
  } catch {
    return null;
  }
}

/** A viewer's message if the room may see it, else null (dropped). Anything too large or not JSON is dropped too. */
export function admitFromViewer(text: string): string | null {
  const v = parse(text);
  if (!v || typeof v.ch !== "string" || typeof v.body?.type !== "string") return null;
  return VIEWER_ALLOWED.has(`${v.ch}.${v.body.type}`) ? text : null;
}

/** A `join` gets the role's flags (a host leads, a viewer never does); every other message passes untouched. */
export function withRole(text: string, role: BroadcastRole): string {
  const v = parse(text);
  if (v?.ch !== "control" || v.body?.type !== "join" || typeof v.body.participant !== "object" || v.body.participant === null)
    return text;
  const isHost = role === "host";
  v.body.participant = { ...(v.body.participant as object), isHost, canLead: isHost };
  return JSON.stringify(v);
}

/**
 * The envelope as a viewer receives it: a participants list keeps the host(s) only; anything else is unchanged (the same
 * object, so callers can tell nothing was filtered).
 */
export function forViewer(envelope: Outgoing["envelope"]): Outgoing["envelope"] {
  if (envelope.ch !== "presence" || envelope.body.type !== "participants") return envelope;
  return { ...envelope, body: { ...envelope.body, participants: envelope.body.participants.filter((p) => p.isHost) } };
}
