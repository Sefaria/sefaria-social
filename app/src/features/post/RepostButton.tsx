// Repost (spec 030 AC-001): the new state and count show at once; if the server refuses, the earlier state comes back and the
// failure is announced. Pressed is an icon change and aria-pressed, never colour alone.
import { useState } from "react";
import { useSocialApi } from "~/features/api/social-api";
import { useStrings } from "~/features/shell/use-strings";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import styles from "./post.module.css";

export function RepostButton({ postId, reposted, count }: { postId: string; reposted: boolean; count: number }) {
  const t = useStrings();
  const api = useSocialApi();
  const [state, setState] = useState({ reposted, count });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const press = async () => {
    if (!api || busy) return;
    const before = state;
    const next = { reposted: !before.reposted, count: Math.max(0, before.count + (before.reposted ? -1 : 1)) };
    setState(next);
    setError("");
    setBusy(true);
    try {
      const answer = await api.repost(postId, next.reposted);
      setState({ reposted: answer.reposted, count: answer.repostCount });
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
        className={`${kit.iconButton} ${styles.repost}`}
        aria-pressed={state.reposted}
        aria-label={`${state.reposted ? t.undoRepost : t.repost} (${t.repostCount(state.count)})`}
        onClick={() => void press()}
        data-action="repost"
        data-reposted={state.reposted ? "true" : "false"}
      >
        <Icon name="repost" size={18} />
        <span className={styles.number} data-repost-count="">
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
