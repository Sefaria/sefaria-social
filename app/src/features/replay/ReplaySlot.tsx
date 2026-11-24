import { lazy, Suspense, useEffect } from "react";
import { useHost } from "~/features/host/host-context";
import { readRecordingCtx } from "./replay-controller";
import { useReplayController, useReplayView } from "./use-replay";

// The window, the transport and their styles are their own chunk, like the call's panel: the entry carries only this slot.
const ReplayWindow = lazy(() => import("./ReplayWindow").then((m) => ({ default: m.ReplayWindow })));

/**
 * Where a recording's replay renders in the persistent mount (spec 042), beside the call's slot. On mount it reopens, paused at
 * the start, the recording the address's `ctx=social.rec.<id>` names (a reload, AC-006). When the reader's context moves away
 * from the open recording (Back, or any navigation that drops it), the replay closes and the reader stays where it is.
 */
export function ReplaySlot() {
  const host = useHost();
  const controller = useReplayController();
  const view = useReplayView(controller);

  useEffect(() => {
    if (!host || !controller) return;
    controller.fromContext();
    return host.reader.context.subscribe(() => {
      const open = controller.view();
      if (open.kind === "closed") return;
      if (readRecordingCtx(host.reader.context.get()) !== open.recordingId) controller.close();
    });
  }, [host, controller]);

  if (view.kind === "closed") return null;
  return (
    <Suspense fallback={null}>
      <ReplayWindow />
    </Suspense>
  );
}
