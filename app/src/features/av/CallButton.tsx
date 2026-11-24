import { useStrings } from "~/features/shell/use-strings";
import { useCallController, useCallsAvailable, useCallView } from "./use-call";

/**
 * "Join call" for a room (spec 034 AC-002): in the lobby (which knows `available` from the room) and in the follow bar (which
 * asks once). Hidden when calls are not available, and while the viewer is already in this room's call. Pressing it opens the
 * pre-join step, which is the first moment the media code loads (AC-003).
 */
export function CallButton({ roomId, available }: { roomId: string; available?: boolean }) {
  const t = useStrings();
  const controller = useCallController();
  const view = useCallView(controller);
  const ok = useCallsAvailable(roomId, available);
  if (!controller || !ok) return null;
  if (view.kind !== "off" && view.kind !== "ended" && view.roomId === roomId) return null;
  return (
    <button type="button" data-action="join-call" onClick={() => void controller.open(roomId)}>
      {t.joinCall}
    </button>
  );
}
