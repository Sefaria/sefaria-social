// `/social/p/$postId` (spec 023 AC-005, spec 024 AC-004): one post on its own page, its replies oldest first, and a reply box.
// A shared link lands here, never on the home page. An unknown or deleted post shows social's own not-found message.
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { PostWithReplies, Reply } from "~/features/api/social-api";
import { SocialApiError, useSocialApi } from "~/features/api/social-api";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { langAttrs } from "~/features/shell/strings";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import { RelativeTime } from "~/ui/RelativeTime";
import { PostCard } from "./PostCard";
import styles from "./post-page.module.css";

export const REPLY_MAX = 1000;

type State =
  { kind: "loading" } | { kind: "ready"; data: PostWithReplies } | { kind: "missing" } | { kind: "error" } | { kind: "deleted" };

export function PostPage({ postId }: { postId: string }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  const viewer = useViewer();
  const host = useHost();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!api || !viewer) return;
    let live = true;
    setState({ kind: "loading" });
    api.getPost(postId).then(
      (data) => live && setState({ kind: "ready", data }),
      (e: unknown) => live && setState({ kind: e instanceof SocialApiError && e.status === 404 ? "missing" : "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, viewer, postId]);

  const added = (r: Reply) =>
    setState((s) => (s.kind === "ready" ? { kind: "ready", data: { ...s.data, replies: [...s.data.replies, r] } } : s));
  const removed = (id: string) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", data: { ...s.data, replies: s.data.replies.filter((r) => r.id !== id) } } : s,
    );

  return (
    <main data-social-page="post" className={styles.page} {...langAttrs(lang)}>
      <nav className={styles.back}>
        <Link to="/social" className={kit.iconButton} data-action="back">
          <span className={styles.flip}>
            <Icon name="arrowStart" size={18} />
          </span>
          {t.backToTimeline}
        </Link>
      </nav>
      <h1 className={kit.visuallyHidden}>{state.kind === "ready" ? state.data.post.author.name : t.feed}</h1>
      {!viewer ? (
        <div className={kit.empty}>
          <p className={kit.emptyBody}>{t.feedSignedOut}</p>
          <button
            type="button"
            className={`${kit.button} ${kit.primary}`}
            onClick={() => host?.viewer.requestSignIn()}
            data-action="sign-in"
          >
            {t.signIn}
          </button>
        </div>
      ) : state.kind === "loading" ? (
        <p role="status">{t.loading}</p>
      ) : state.kind === "missing" ? (
        <div className={kit.empty} data-post-missing="">
          <p className={kit.emptyTitle}>{t.notFoundTitle}</p>
          <p className={kit.emptyBody}>{t.postNotFound}</p>
          <Link to="/social" className={`${kit.button} ${kit.secondary}`}>
            {t.backToFeed}
          </Link>
        </div>
      ) : state.kind === "error" ? (
        <p role="alert">{t.postError}</p>
      ) : state.kind === "deleted" ? (
        <div className={kit.empty}>
          <p className={kit.emptyBody} role="status">
            {t.deleted}
          </p>
          <Link to="/social" className={`${kit.button} ${kit.secondary}`}>
            {t.backToFeed}
          </Link>
        </div>
      ) : (
        <>
          <PostCard
            post={state.data.post}
            standalone
            replyCount={state.data.replies.length}
            onDeleted={() => setState({ kind: "deleted" })}
          />
          <section className={styles.replies} aria-labelledby="replies-title" data-replies="">
            <h2 id="replies-title" className={styles.repliesTitle}>
              {t.repliesTitle}
            </h2>
            {state.data.replies.length === 0 ? (
              <p className={styles.none}>{t.noReplies}</p>
            ) : (
              <ol className={styles.list}>
                {state.data.replies.map((r) => (
                  <li key={r.id}>
                    <ReplyItem reply={r} onDeleted={removed} />
                  </li>
                ))}
              </ol>
            )}
            <ReplyForm postId={postId} onSent={added} />
          </section>
        </>
      )}
    </main>
  );
}

function ReplyItem({ reply, onDeleted }: { reply: Reply; onDeleted: (id: string) => void }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useSocialApi();
  return (
    <article className={styles.reply} data-reply={reply.id}>
      <Avatar id={reply.author.id} name={reply.author.name} kind={reply.author.kind} size={32} />
      <div className={styles.replyMain}>
        <header className={styles.replyHeader}>
          <Link to="/social/u/$profileId" params={{ profileId: reply.author.id }} className={styles.replyAuthor}>
            {reply.author.name}
          </Link>
          <span className={styles.muted}>
            <RelativeTime iso={reply.createdAt} t={t} lang={lang} />
          </span>
          {reply.canDelete ? (
            <button
              type="button"
              className={`${kit.iconButton} ${styles.push}`}
              aria-label={t.deleteReply}
              onClick={() =>
                api &&
                void api.deleteReply(reply.id).then(
                  () => onDeleted(reply.id),
                  () => undefined,
                )
              }
              data-action="delete-reply"
            >
              <Icon name="trash" size={16} />
            </button>
          ) : null}
        </header>
        <p className={styles.replyBody} dir="auto">
          {reply.body}
        </p>
      </div>
    </article>
  );
}

function ReplyForm({ postId, onSent }: { postId: string; onSent: (r: Reply) => void }) {
  const t = useStrings();
  const api = useSocialApi();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api || !body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      onSent(await api.reply(postId, body.trim()));
      setBody("");
    } catch {
      setError(t.replyFailed);
    } finally {
      setSending(false);
    }
  };
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} data-reply-form="">
      <label htmlFor={id} className={kit.visuallyHidden}>
        {t.replyLabel}
      </label>
      <textarea
        id={id}
        className={`${kit.textarea} ${styles.textarea}`}
        rows={2}
        maxLength={REPLY_MAX}
        dir="auto"
        placeholder={t.replyPlaceholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        data-reply-body=""
      />
      <div className={styles.formBar}>
        {error ? (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        ) : null}
        <button type="submit" className={`${kit.button} ${kit.primary}`} disabled={!body.trim() || sending} data-action="reply">
          {t.reply}
        </button>
      </div>
    </form>
  );
}
