import { lazy, Suspense } from "react";
import { useCallController, useCallView } from "./use-call";

// The panel, the window, the pre-join step and the tiles are their own chunk: the entry carries only this slot, the Join call
// button and the controller (spec 035; spec 040's cap on the entry's growth). LiveKit itself is a further chunk, loaded by
// the pre-join step (load-livekit.ts).
const CallPanel = lazy(() => import("./CallPanel").then((m) => ({ default: m.CallPanel })));

/** Where the call renders in the persistent mount: nothing, and nothing loaded, while there is no call. */
export function CallSlot() {
  const view = useCallView(useCallController());
  if (view.kind === "off") return null;
  return (
    <Suspense fallback={null}>
      <CallPanel />
    </Suspense>
  );
}
