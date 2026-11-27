// Follow / Following (spec 025 AC-005): one tap, the new state and count at once, the earlier state back if the server refuses.
// "Following" reads as a quiet outline; hovering it offers to unfollow.
import { useState } from "react";
import { useSocialApi } from "~/features/api/social-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./profile.module.css";

export function FollowButton({
  profileId,
  following,
  onChange,
  name,
}: {
  profileId: string;
  following: boolean;
  onChange?: (state: { following: boolean; followers: number | null }) => void;
  name: string;
}) {
  const t = useStrings();
  const api = useSocialApi();
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const press = async () => {
    if (!api || busy) return;
    const next = !on;
    setOn(next);
    setFailed(false);
    onChange?.({ following: next, followers: null });
    setBusy(true);
    try {
      const answer = await api.follow(profileId, next);
      setOn(answer.following);
      onChange?.(answer);
    } catch {
      setOn(!next);
      setFailed(true);
      onChange?.({ following: !next, followers: null });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={styles.followWrap}>
      <button
        type="button"
        className={
          on ? `${kit.button} ${kit.secondary} ${kit.small} ${styles.followingButton}` : `${kit.button} ${kit.ink} ${kit.small}`
        }
        aria-pressed={on}
        aria-label={`${on ? t.following_ : t.follow} ${name}`}
        onClick={() => void press()}
        data-action="follow"
        data-following={on ? "true" : "false"}
      >
        <span className={styles.followLabel}>{on ? t.following_ : t.follow}</span>
        {on ? <span className={styles.unfollowLabel}>{t.unfollow}</span> : null}
      </button>
      {failed ? (
        <span role="alert" className={kit.visuallyHidden}>
          {t.reactionFailed}
        </span>
      ) : null}
    </span>
  );
}
