import type { ReactNode } from "react";
import { CallStrip } from "./CallStrip";
import { CallWindow, useViewport, type FrameOwner } from "./CallWindow";

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
  prompt,
  owner = "call",
  label,
  title,
}: {
  children: ReactNode;
  pill: (expand: () => void) => ReactNode;
  notice?: ReactNode;
  /** Shown in every size, the pill and the collapsed strip too: the window owner's question (spec 042 AC-007). */
  prompt?: ReactNode;
  /** What the frame holds: the call, or a recording's replay (spec 042), which shares its geometry. */
  owner?: FrameOwner;
  /** The frame's accessible name; the call window's by default. */
  label?: string;
  /** The text on the drag handle; "Call" by default. */
  title?: string;
}) {
  const { width } = useViewport();
  const frame = { pill, prompt, owner, label, title };
  return width < PHONE_MAX_WIDTH ? (
    <CallStrip {...frame} notice={notice}>
      {children}
    </CallStrip>
  ) : (
    <CallWindow {...frame}>{children}</CallWindow>
  );
}
