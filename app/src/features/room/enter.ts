// One press into a room (spec 049; docs/plans/shiur.md D6): the reader goes into the room's context and, when the room offers
// calls, the viewer joins its call straight away — the room's owner with their last microphone and camera choice, anyone else
// with both off — so nobody presses Enter, Join call and a pre-join Join one after another.
import { BOTH_OFF, rememberedChoice } from "~/features/av/device-memory";
import type { CallController } from "~/features/av/call-controller";
import type { RoomController } from "~/features/session/controller";

export interface EnterRoom {
  roomId: string;
  /** The viewer owns the room (they start with their remembered choice). */
  owner: boolean;
  /** The server offers calls for this room. */
  calls: boolean;
  rooms: Pick<RoomController, "enlarge"> | null;
  call: Pick<CallController, "enter"> | null;
}

export async function enterRoom({ roomId, owner, calls, rooms, call }: EnterRoom): Promise<void> {
  if (calls && call) void call.enter(roomId, owner ? rememberedChoice() : BOTH_OFF);
  await rooms?.enlarge(roomId);
}

/**
 * A Join pressed while signed out (spec 049 AC-003) rides in the lobby's own address (`?join=1`): the reader sends sign-in back
 * to the page it came from. The address alone is not enough — anyone could send such a link — so the press also leaves a marker
 * for this tab (sessionStorage, the room's id), and the lobby carries on only when both are there.
 */
export const PENDING_JOIN_PARAM = "join";
const PENDING_KEY = "social.pendingJoin";

export const lobbyPath = (roomId: string, pendingJoin = false) =>
  `/social/r/${roomId}${pendingJoin ? `?${PENDING_JOIN_PARAM}=1` : ""}`;

/** The person pressed Join while signed out, in this tab, for this room. */
export function markPendingJoin(roomId: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, roomId);
  } catch {
    // without storage they press Join again after signing in
  }
}

/** True once when the address says a Join is waiting and this tab pressed it for this room; the marker is used up. */
export function takePendingJoin(roomId: string, search: string): boolean {
  if (new URLSearchParams(search).get(PENDING_JOIN_PARAM) !== "1") return false;
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== roomId) return false;
    sessionStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasPendingJoinFlag(search: string): boolean {
  return new URLSearchParams(search).get(PENDING_JOIN_PARAM) === "1";
}
