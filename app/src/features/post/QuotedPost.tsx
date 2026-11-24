// The post a quote carries (spec 030 AC-002): its author, time, words and source, set inside the quote and linking to its own
// page; "This post was deleted" once it is gone.
import { Link } from "@tanstack/react-router";
import type { Post } from "~/features/api/social-api";
import { useInterfaceLang } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import { RelativeTime } from "~/ui/RelativeTime";
import styles from "./post.module.css";

export function QuotedPost({ quoted }: { quoted: NonNullable<Post["quoted"]> }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  if (!quoted.author || quoted.body === null || !quoted.createdAt)
    return (
      <div className={`${styles.quoted} ${styles.quotedGone}`} data-quoted={quoted.id} data-quoted-state="deleted">
        {t.quotedUnavailable}
      </div>
    );
  return (
    <Link to="/social/p/$postId" params={{ postId: quoted.id }} className={styles.quoted} data-quoted={quoted.id}>
      <span className={styles.quotedHeader}>
        <Avatar id={quoted.author.id} name={quoted.author.name} kind={quoted.author.kind} size={20} />
        <span className={styles.quotedAuthor}>{quoted.author.name}</span>
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
        <span className={styles.time}>
          <RelativeTime iso={quoted.createdAt} t={t} lang={lang} />
        </span>
      </span>
      <span className={styles.quotedBody} dir="auto">
        {quoted.body}
      </span>
      {quoted.ref ? <span className={styles.quotedRef}>{quoted.ref}</span> : null}
    </Link>
  );
}
