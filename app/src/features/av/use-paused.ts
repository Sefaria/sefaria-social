import { useCallback, useEffect, useState } from "react";
import type { CallController } from "./call-controller";

/**
 * A call the browser paused while its tab was in the background (spec 037 AC-004): phones stop a hidden tab's audio, and it
 * starts again only inside a tap. When the tab is shown again with audio blocked, `paused` is true until `resume()` (called
 * from the tap) starts it. A dropped connection is the controller's Reconnecting and Rejoin, not this.
 */
export function usePaused(controller: CallController | null): { paused: boolean; resume: () => void } {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!controller || typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (controller.view().kind === "in-call" && controller.media()?.audioBlocked()) setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [controller]);
  const resume = useCallback(() => {
    void controller?.media()?.startAudio();
    setPaused(false);
  }, [controller]);
  return { paused, resume };
}
