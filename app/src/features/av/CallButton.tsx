import { useStrings } from "~/features/shell/use-strings";
import { useCallController, useCallsAvailable, useCallView } from "./use-call";
import { useWindowOwner } from "./WindowPrompt";

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
  const owner = useWindowOwner();
  if (!controller || !ok) return null;
  if (view.kind !== "off" && view.kind !== "ended" && view.roomId === roomId) return null;
  // A replay holds the window: ask first, and close it on confirmation (spec 042 AC-007).
  const join = async () => {
    if (owner && !(await owner.request("call"))) return;
    await controller.open(roomId);
  };
  return (
    <button type="button" data-action="join-call" onClick={() => void join()}>
      {t.joinCall}
    </button>
  );
}
