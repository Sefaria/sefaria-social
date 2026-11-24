// Quote a post (spec 030 AC-002): a short form under the post; posting it creates a post of the viewer's own that carries the
// quoted one. Enter with ⌘/Ctrl posts, Escape cancels.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Post } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { POST_MAX } from "./Composer";
import styles from "./post.module.css";

export function QuoteComposer({
  postId,
  onDone,
  onPosted,
}: {
  postId: string;
  onDone: () => void;
  onPosted?: (post: Post) => void;
}) {
  const t = useStrings();
  const api = useSocialApi();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => area.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api || posting || !body.trim()) return;
    setPosting(true);
    setError("");
    try {
      const post = await api.createPost({ body: body.trim(), quotedPostId: postId });
      onPosted?.(post);
      onDone();
    } catch {
      setError(t.quoteFailed);
      setPosting(false);
    }
  };

  return (
    <form className={styles.quoteForm} onSubmit={(e) => void submit(e)} aria-label={t.quoteLabel} data-quote-composer="">
      <label htmlFor={id} className={kit.visuallyHidden}>
        {t.quoteLabel}
      </label>
      <textarea
        id={id}
        ref={area}
        className={kit.textarea}
        rows={2}
        dir="auto"
        maxLength={POST_MAX}
        placeholder={t.quotePlaceholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          if (e.key === "Escape") onDone();
        }}
        data-quote-body=""
      />
      <div className={styles.confirmActions}>
        <button
          type="submit"
          className={`${kit.button} ${kit.primary} ${kit.small}`}
          disabled={posting || !body.trim()}
          data-action="post-quote"
        >
          {posting ? t.posting : t.quotePost}
        </button>
        <button type="button" className={`${kit.button} ${kit.ghost} ${kit.small}`} onClick={onDone}>
          {t.cancel}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
