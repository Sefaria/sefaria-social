// Editing one's profile in settings (spec 025 AC-006): name, @handle (spec 057 AC-004), bio and its remaining characters, Save,
// and a polite "Saved". A handle the server refuses is said under the Handle field, and what was typed stays.
import { useEffect, useId, useState, type FormEvent } from "react";
import { SocialApiError, useSocialApi } from "~/features/api/social-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./profile.module.css";
import { refreshMe, useMe } from "./use-me";

export const BIO_MAX = 300;

export function ProfileForm() {
  const t = useStrings();
  const api = useSocialApi();
  const me = useMe();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<"invalid" | "taken" | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const ids = { name: useId(), bio: useId(), hint: useId(), handle: useId(), handleHint: useId() };

  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setBio(me.bio);
    setHandle(me.handle);
  }, [me]);

  if (!me || !api) return <p role="status">{t.loading}</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setHandleError(null);
    try {
      const next = await api.updateMe({ name: name.trim(), bio: bio.trim(), handle: handle.trim() });
      await refreshMe(api, next);
      setHandle(next.handle);
      setStatus("saved");
    } catch (err) {
      const code = err instanceof SocialApiError ? err.code : "";
      if (code === "profile.handle_invalid" || code === "request.invalid") setHandleError("invalid");
      else if (code === "profile.handle_taken") setHandleError("taken");
      setStatus("failed");
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} data-profile-form="">
      <div className={kit.field}>
        <label htmlFor={ids.name} className={kit.label}>
          {t.name}
        </label>
        <input
          id={ids.name}
          className={kit.input}
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          dir="auto"
        />
      </div>
      <div className={kit.field}>
        <label htmlFor={ids.handle} className={kit.label}>
          {t.handle}
        </label>
        <div className={styles.handleInput} dir="ltr">
          <span aria-hidden="true">@</span>
          <input
            id={ids.handle}
            className={kit.input}
            value={handle}
            maxLength={31}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={ids.handleHint}
            aria-invalid={handleError ? true : undefined}
            onChange={(e) => {
              setHandle(e.target.value);
              setHandleError(null);
            }}
            data-profile-handle-input=""
          />
        </div>
        <span
          id={ids.handleHint}
          className={handleError ? styles.fieldError : kit.hint}
          data-handle-error={handleError ?? undefined}
        >
          {handleError === "taken" ? t.handleTaken : handleError === "invalid" ? t.handleInvalid : t.handleHint}
        </span>
      </div>
      <div className={kit.field}>
        <label htmlFor={ids.bio} className={kit.label}>
          {t.bio}
        </label>
        <textarea
          id={ids.bio}
          className={kit.textarea}
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          aria-describedby={ids.hint}
          onChange={(e) => setBio(e.target.value)}
          dir="auto"
          data-profile-bio-input=""
        />
        <span id={ids.hint} className={kit.hint}>
          {t.bioHint} {t.bioLeft(BIO_MAX - bio.length)}
        </span>
      </div>
      <div className={styles.formBar}>
        <button
          type="submit"
          className={`${kit.button} ${kit.primary}`}
          disabled={status === "saving" || !name.trim()}
          data-action="save-profile"
        >
          {status === "saving" ? t.saving : t.save}
        </button>
        <span role="status" aria-live="polite" data-profile-status={status}>
          {status === "saved" ? t.saved : status === "failed" && !handleError ? t.saveFailed : ""}
        </span>
      </div>
    </form>
  );
}
