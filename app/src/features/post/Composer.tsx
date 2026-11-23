// The composer (spec 023 AC-004, spec 025 AC-006): an invitation to share a Torah thought, optionally anchored to a source —
// pre-filled with what the reader has open — and "Post as" for the institutions the viewer runs. One primary button, disabled
// until there is something to say; the count appears near the limit.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Post } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useHost } from "~/features/host/host-context";
import { useMe } from "~/features/profile/use-me";
import { summaryOf } from "~/features/session/room-reader";
import { useStrings } from "~/features/shell/use-strings";
import { Avatar } from "~/ui/Avatar";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import styles from "./composer.module.css";

export const POST_MAX = 2000;
const WARN_AT = 200;

/** The source the reader has open, if it is showing a text (not a social page). */
function readingRef(host: ReturnType<typeof useHost>): string {
  if (!host) return "";
  try {
    const url = host.reader.state.getSnapshot().url;
    if (url.startsWith("/social")) return "";
    return summaryOf(url, host.reader.commands)?.ref ?? "";
  } catch {
    return "";
  }
}

export function Composer({ onPosted }: { onPosted: (post: Post) => void }) {
  const t = useStrings();
  const api = useSocialApi();
  const host = useHost();
  const me = useMe();
  const [body, setBody] = useState("");
  const [ref, setRef] = useState(() => readingRef(host));
  const [asProfile, setAsProfile] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const ids = { body: useId(), ref: useId(), hint: useId(), as: useId() };
  const left = POST_MAX - body.length;
  const ready = body.trim().length > 0 && !posting;

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.blockSize = "auto";
    el.style.blockSize = `${Math.min(el.scrollHeight, 320)}px`;
  }, [body]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api || !ready) return;
    setPosting(true);
    setError("");
    try {
      const post = await api.createPost({
        body: body.trim(),
        ...(ref.trim() ? { ref: ref.trim() } : {}),
        ...(asProfile ? { asProfileId: asProfile } : {}),
      });
      onPosted(post);
      setBody("");
      setRef(readingRef(host));
    } catch {
      setError(t.postFailed);
    } finally {
      setPosting(false);
    }
  };

  const author = me?.administers.find((a) => a.id === asProfile);
  return (
    <form className={styles.composer} onSubmit={(e) => void submit(e)} aria-label={t.composerLabel} data-composer="">
      {me ? (
        <Avatar id={author?.id ?? me.id} name={author?.name ?? me.name} kind={author ? "institution" : "person"} />
      ) : (
        <span className={`${kit.skeleton} ${styles.avatarSkeleton}`} aria-hidden="true" />
      )}
      <div className={styles.fields}>
        <label htmlFor={ids.body} className={kit.visuallyHidden}>
          {t.composerLabel}
        </label>
        <textarea
          id={ids.body}
          ref={area}
          className={styles.body}
          placeholder={t.composerPlaceholder}
          value={body}
          maxLength={POST_MAX}
          rows={2}
          dir="auto"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
          data-composer-body=""
        />
        <div className={styles.source}>
          <Icon name="book" size={16} />
          <label htmlFor={ids.ref} className={kit.visuallyHidden}>
            {t.composerSource}
          </label>
          <input
            id={ids.ref}
            className={styles.ref}
            value={ref}
            maxLength={200}
            placeholder={t.composerSourcePlaceholder}
            aria-describedby={ids.hint}
            onChange={(e) => setRef(e.target.value)}
            data-composer-ref=""
          />
          <span id={ids.hint} className={kit.visuallyHidden}>
            {t.composerSourceHint}
          </span>
        </div>
        <div className={styles.bar}>
          {me && me.administers.length > 0 ? (
            <span className={styles.as}>
              <label htmlFor={ids.as}>{t.composerPostAs}</label>
              <select id={ids.as} value={asProfile} onChange={(e) => setAsProfile(e.target.value)} data-composer-as="">
                <option value="">{me.name}</option>
                {me.administers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
          <span className={styles.push} />
          {left <= WARN_AT ? (
            <span className={left <= 20 ? `${styles.left} ${styles.warn}` : styles.left} aria-live="polite" data-composer-left="">
              {t.composerLeft(left)}
            </span>
          ) : null}
          <button type="submit" className={`${kit.button} ${kit.primary}`} disabled={!ready} data-action="post">
            {posting ? t.posting : t.post}
          </button>
        </div>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
