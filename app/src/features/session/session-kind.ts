// What a session is, as chosen at Start (spec 050 AC-006): a room (people join and talk), a broadcast (people watch) or just
// me (a recording). It decides the owner's word for ending (AC-007): Close room, End broadcast, Finish and save. Kept for this
// tab per room in sessionStorage (read and written in try/catch); after a reload or in another tab the owner sees Close room,
// or End broadcast while the room has a live broadcast.

export type SessionKind = "room" | "broadcast" | "recording";

const KEY = "social.sessionKinds";

function read(): Record<string, SessionKind> {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, SessionKind>) : {};
  } catch {
    return {};
  }
}

export function sessionKindOf(roomId: string): SessionKind | null {
  const k = read()[roomId];
  return k === "room" || k === "broadcast" || k === "recording" ? k : null;
}

export function setSessionKind(roomId: string, kind: SessionKind): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [roomId]: kind }));
  } catch {
    // the owner sees Close room
  }
}
