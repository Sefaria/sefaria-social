import { useState, type ReactNode } from "react";
import { useStrings } from "~/features/shell/use-strings";
import { RecordingBadge } from "~/features/recording/RecordingBadge";
import { useCallRecording } from "~/features/recording/use-recording";
import { CallWindowSize, type FrameOwner } from "./CallWindow";
import { useChromeInsets } from "./insets";
import { useCallController, useCallView } from "./use-call";
import styles from "./strip.module.css";

/**
 * The call on a phone (spec 037): a full-width strip under the reader's top inset, no drag or resize. In a call it starts
 * collapsed at 48px — who is on the call, who is speaking, the microphone, Leave and Expand — and receives no video; expanded it
 * shows the active speaker at 16:9 with the controls. Before and after a call (pre-join, connecting, ended) it shows the panel.
 */
export function CallStrip({
  children,
  pill,
  notice,
  prompt,
  owner = "call",
  label,
}: {
  children: ReactNode;
  pill: (expand: () => void) => ReactNode;
  notice?: ReactNode;
  prompt?: ReactNode;
  owner?: FrameOwner;
  label?: string;
  title?: string;
}) {
  const t = useStrings();
  const controller = useCallController();
  const view = useCallView(controller);
  const insets = useChromeInsets();
  const [expanded, setExpanded] = useState(false);
  const recording = useCallRecording(controller);
  const inCall = owner === "call" && view.kind === "in-call";
  const collapsed = inCall && !expanded;
  return (
    <CallWindowSize.Provider value={collapsed ? "pill" : "strip"}>
      <section
        data-call-strip=""
        data-window-owner={owner}
        data-expanded={String(!collapsed)}
        aria-label={label ?? t.callWindow}
        className={`${styles.strip} ${collapsed ? styles.collapsed : ""}`}
        style={{ top: insets.top, left: 0, right: 0, height: collapsed ? 48 : undefined }}
      >
        {prompt}
        {collapsed ? (
          <div className={styles.bar}>
            {notice /* expanded, the panel shows it */}
            {pill(() => setExpanded(true))}
            <button type="button" data-action="leave-call" className={styles.leave} onClick={() => void controller?.leave()}>
              {t.leaveCall}
            </button>
          </div>
        ) : (
          <>
            {owner === "call" && <RecordingBadge on={recording} />}
            <div data-strip-speaker="" data-aspect="16:9" className={styles.speaker}>
              {children}
            </div>
            {inCall && (
              <button type="button" data-action="collapse-call" onClick={() => setExpanded(false)}>
                {t.collapse}
              </button>
            )}
          </>
        )}
      </section>
    </CallWindowSize.Provider>
  );
}
