// A one-shot line for the rooms page (spec 044 AC-005, AC-006): the lobby sets it just before navigating to /social/rooms after
// deleting or leaving a room, and the rooms page takes it once. Kept in memory rather than in the URL or history state, so it
// survives the host-bridged navigation and never comes back on Back or a reload.
let pending: string | null = null;

export function setRoomsNotice(text: string): void {
  pending = text;
}

export function takeRoomsNotice(): string | null {
  const text = pending;
  pending = null;
  return text;
}
