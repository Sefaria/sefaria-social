// A post (spec 023 AC-005, spec 024): who wrote it and when, what they wrote in the text face, the source it is anchored to with
// the source's opening words, and its actions — replies, Yasher koach, Share, and Delete for its author. One <article>; no card
// inside a card: the source is a quotation set off by a rule, not a box.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Post } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useInterfaceLang } from "~/features/host/host-context";
import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { ShareMenu } from "~/features/share/ShareMenu";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import { RelativeTime } from "~/ui/RelativeTime";
import { SourceText } from "~/ui/SourceText";
import { ReactionButton } from "./ReactionButton";
import styles from "./post.module.css";

export function PostCard({
  post,
  onDeleted,
  standalone = false,
  replyCount,
}: {
  post: Post;
  onDeleted?: (id: string) => void;
  /** On its own page: the time is not a link, and the body is larger. */
  standalone?: boolean;
  /** A reply count the page keeps current (spec 024 AC-004). */
  replyCount?: number;
}) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const replies = replyCount ?? post.replyCount;

  const remove = async () => {
    if (!api) return;
    setDeleting(true);
    setFailed(false);
    try {
      await api.deletePost(post.id);
      onDeleted?.(post.id);
    } catch {
      setFailed(true);
      setDeleting(false);
    }
  };

  const time = <RelativeTime iso={post.createdAt} t={t} lang={lang} />;
  return (
    <article
      className={standalone ? `${styles.post} ${styles.standalone}` : styles.post}
      data-post={post.id}
      aria-labelledby={`post-${post.id}-author`}
    >
      <Link to="/social/u/$profileId" params={{ profileId: post.author.id }} tabIndex={-1} className={styles.avatarLink}>
        <Avatar id={post.author.id} name={post.author.name} kind={post.author.kind} size={standalone ? 48 : 40} />
      </Link>
      <div className={styles.main}>
        <header className={styles.header}>
          <Link
            to="/social/u/$profileId"
            params={{ profileId: post.author.id }}
            className={styles.author}
            id={`post-${post.id}-author`}
            data-post-author=""
          >
            {post.author.name}
          </Link>
          {post.author.kind === "institution" ? <span className={kit.badge}>{t.institution}</span> : null}
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          {standalone ? (
            <span className={styles.time}>{time}</span>
          ) : (
            <Link to="/social/p/$postId" params={{ postId: post.id }} className={styles.time} data-post-link="">
              {time}
            </Link>
          )}
        </header>
        <p className={styles.body} dir="auto" data-post-body="">
          {post.body}
        </p>
        {post.ref ? (
          <figure className={styles.source} data-post-source={post.ref}>
            <figcaption className={styles.sourceRef}>
              <Icon name="book" size={16} />
              <ReaderRefLink textRef={post.ref} beside>
                {post.ref}
              </ReaderRefLink>
            </figcaption>
            <SourceText textRef={post.ref} interfaceLang={lang} unavailableLabel={t.textUnavailable} />
          </figure>
        ) : null}
        <footer className={styles.actions}>
          {standalone ? (
            <span className={kit.iconButton} data-reply-count="">
              <Icon name="reply" size={18} />
              <span className={styles.number}>{t.replies(replies)}</span>
            </span>
          ) : (
            <Link to="/social/p/$postId" params={{ postId: post.id }} className={kit.iconButton} data-reply-count="">
              <Icon name="reply" size={18} />
              <span className={styles.number}>{t.replies(replies)}</span>
            </Link>
          )}
          <ReactionButton postId={post.id} reacted={post.reacted} count={post.reactionCount} />
          <ShareMenu path={`/social/p/${post.id}`} text={post.body} />
          {post.canDelete && !confirming ? (
            <button
              type="button"
              className={`${kit.iconButton} ${styles.push}`}
              onClick={() => setConfirming(true)}
              aria-label={t.deletePost}
              data-action="delete-post"
            >
              <Icon name="trash" size={18} />
            </button>
          ) : null}
        </footer>
        {confirming ? (
          <div className={styles.confirm} role="group" aria-label={t.deletePost} data-confirm-delete="">
            <p>{t.deleteConfirm}</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={`${kit.button} ${kit.danger} ${kit.small}`}
                onClick={() => void remove()}
                disabled={deleting}
                data-action="confirm-delete"
              >
                {t.deletePost}
              </button>
              <button
                type="button"
                className={`${kit.button} ${kit.ghost} ${kit.small}`}
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                {t.cancel}
              </button>
            </div>
            {failed ? <p role="alert">{t.reactionFailed}</p> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** A placeholder row while posts load (skeleton, not a spinner). */
export function PostSkeleton() {
  return (
    <div className={styles.post} aria-hidden="true" data-post-skeleton="">
      <span className={`${kit.skeleton} ${styles.skeletonAvatar}`} />
      <div className={styles.main}>
        <span className={kit.skeleton} style={{ inlineSize: "40%", blockSize: 14 }} />
        <span className={kit.skeleton} style={{ inlineSize: "95%", blockSize: 14, marginBlockStart: 12 }} />
        <span className={kit.skeleton} style={{ inlineSize: "80%", blockSize: 14, marginBlockStart: 8 }} />
      </div>
    </div>
  );
}
