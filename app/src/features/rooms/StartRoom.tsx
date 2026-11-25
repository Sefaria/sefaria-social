// Start a room (spec 044 AC-001): a button that opens a small dialog asking for the room's name, creates it and opens its lobby.
// The name is required (Start stays disabled while it is blank) and at most 120 characters, as the API requires. Escape and
// Cancel close the dialog and return focus to the button; a failed create keeps it open with the reason.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useHost } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useRoomsApi } from "~/features/api/rooms-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./rooms.module.css";

export const ROOM_NAME_MAX = 120;

export function StartRoom({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const t = useStrings();
  const host = useHost();
  const api = useRoomsApi();
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!viewer || !api?.create) return null;

  function close() {
    setOpen(false);
    setName("");
    setFailed(false);
    button.current?.focus();
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = name.trim();
    if (!title || busy || !api?.create) return;
    setBusy(true);
    setFailed(false);
    try {
      const room = await api.create(title);
      setOpen(false);
      setName("");
      host?.navigate(`/social/r/${room.id}`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${kit.button} ${variant === "primary" ? kit.primary : kit.secondary}`}
        data-action="start-room"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {t.startRoom}
      </button>
      {open && (
        <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && !busy && close()}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={hintId}
            className={styles.dialog}
            data-start-room-dialog=""
            onSubmit={(e) => void submit(e)}
          >
            <h2 id={titleId} className={styles.dialogTitle}>
              {t.startRoomTitle}
            </h2>
            <p id={hintId} className={kit.hint}>
              {t.startRoomHint}
            </p>
            <label className={kit.field}>
              <span className={kit.label}>{t.roomName}</span>
              <input
                ref={input}
                className={kit.input}
                name="title"
                value={name}
                maxLength={ROOM_NAME_MAX}
                autoComplete="off"
                dir="auto"
                onChange={(e) => setName(e.target.value)}
                data-room-name=""
              />
            </label>
            {failed && (
              <p role="alert" className={styles.error}>
                {t.roomCreateFailed}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={`${kit.button} ${kit.ghost}`}
                onClick={close}
                disabled={busy}
                data-action="cancel-start-room"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className={`${kit.button} ${kit.primary}`}
                disabled={busy || name.trim() === ""}
                data-action="confirm-start-room"
              >
                {busy ? t.starting : t.start}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
