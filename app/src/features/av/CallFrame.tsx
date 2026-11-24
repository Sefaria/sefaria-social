import type { ReactNode } from "react";
import { CallStrip } from "./CallStrip";
import { CallWindow, useViewport } from "./CallWindow";

/** Below this width the call docks as a strip instead of floating (spec 037). */
export const PHONE_MAX_WIDTH = 600;

/**
 * The call's frame: the floating window (spec 035), or on a narrow screen the docked strip (spec 037). Switching frames (a
 * rotation) remounts only the frame and the panel's elements; the call lives in the controller and is never touched.
 */
export function CallFrame({
  children,
  pill,
  notice,
}: {
  children: ReactNode;
  pill: (expand: () => void) => ReactNode;
  notice?: ReactNode;
}) {
  const { width } = useViewport();
  return width < PHONE_MAX_WIDTH ? (
    <CallStrip pill={pill} notice={notice}>
      {children}
    </CallStrip>
  ) : (
    <CallWindow pill={pill}>{children}</CallWindow>
  );
}
