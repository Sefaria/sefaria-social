// Invite people (spec 044 AC-003): the room's full link, Copy (announced politely as "Copied") and the Share menu. Holding the
// link is the invitation (spec 011), so this is all a member needs to bring someone in.
import { useState } from "react";
import { useHost } from "~/features/host/host-context";
import { absoluteLink } from "~/features/share/share";
import { ShareMenu } from "~/features/share/ShareMenu";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./lobby.module.css";

export function InvitePanel({ roomId, title }: { roomId: string; title: string }) {
  const t = useStrings();
  const host = useHost();
  const path = `/social/r/${roomId}`;
  const link = absoluteLink(host, path);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="social-invite" data-invite="">
      <h2 id="social-invite" className={styles.cardTitle}>
        {t.invitePeople}
      </h2>
      <p className={kit.hint}>{t.inviteHint}</p>
      <div className={styles.linkRow}>
        <input
          className={`${kit.input} ${styles.linkInput}`}
          readOnly
          value={link}
          aria-label={t.roomLink}
          onFocus={(e) => e.currentTarget.select()}
          data-room-link=""
          dir="ltr"
        />
        <button
          type="button"
          className={`${kit.button} ${kit.secondary}`}
          onClick={() => void copy()}
          data-action="copy-room-link"
        >
          {copied ? t.copied : t.copy}
        </button>
        <ShareMenu path={path} text={title} />
      </div>
      <span className={kit.visuallyHidden} aria-live="polite">
        {copied ? t.copied : ""}
      </span>
    </section>
  );
}
