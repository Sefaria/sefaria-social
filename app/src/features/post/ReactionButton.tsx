// Yasher koach (spec 024 AC-003): the new state and count show at once; if the server refuses, the earlier state comes back and
// the failure is announced. Pressed is an icon change and aria-pressed, never colour alone; the count uses tabular figures.
import { useState } from "react";
import { useSocialApi } from "~/features/api/social-api";
import { useStrings } from "~/features/shell/use-strings";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import styles from "./post.module.css";

export function ReactionButton({ postId, reacted, count }: { postId: string; reacted: boolean; count: number }) {
  const t = useStrings();
  const api = useSocialApi();
  const [state, setState] = useState({ reacted, count });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const press = async () => {
    if (!api || busy) return;
    const before = state;
    const next = { reacted: !before.reacted, count: Math.max(0, before.count + (before.reacted ? -1 : 1)) };
    setState(next);
    setError("");
    setBusy(true);
    try {
      const answer = await api.react(postId, next.reacted);
      setState({ reacted: answer.reacted, count: answer.reactionCount });
    } catch {
      setState(before);
      setError(t.reactionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${kit.iconButton} ${styles.reaction}`}
        aria-pressed={state.reacted}
        aria-label={`${t.yasherKoach} (${t.yasherKoachCount(state.count)})`}
        onClick={() => void press()}
        data-action="react"
        data-reacted={state.reacted ? "true" : "false"}
      >
        <Icon name={state.reacted ? "sparkFilled" : "spark"} size={18} />
        <span className={styles.reactionLabel}>{t.yasherKoach}</span>
        <span className={styles.number} data-reaction-count="">
          {state.count}
        </span>
      </button>
      {error ? (
        <span role="alert" className={styles.inlineError}>
          {error}
        </span>
      ) : null}
    </>
  );
}
