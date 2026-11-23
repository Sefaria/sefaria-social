// Editing one's profile in settings (spec 025 AC-006): name and bio, the bio's remaining characters, Save, and a polite "Saved".
import { useEffect, useId, useState, type FormEvent } from "react";
import { useSocialApi } from "~/features/api/social-api";
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
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const ids = { name: useId(), bio: useId(), hint: useId() };

  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setBio(me.bio);
  }, [me]);

  if (!me || !api) return <p role="status">{t.loading}</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    try {
      const next = await api.updateMe({ name: name.trim(), bio: bio.trim() });
      await refreshMe(api, next);
      setStatus("saved");
    } catch {
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
          {status === "saved" ? t.saved : status === "failed" ? t.saveFailed : ""}
        </span>
      </div>
    </form>
  );
}
