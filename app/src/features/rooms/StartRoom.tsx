// Start a room (spec 044 AC-001): a button that opens a small dialog asking for the room's name and creates it. Spec 049 AC-001:
// Start then takes the starter straight into the room (its reader context) and its call, with no lobby, Enter or pre-join step.
// The name is required (Start stays disabled while it is blank) and at most 120 characters, as the API requires. Escape and
// Cancel close the dialog and return focus to the button; a failed create keeps it open with the reason.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useHost } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useRoomsApi } from "~/features/api/rooms-api";
import { useCallController } from "~/features/av/use-call";
import { broadcastControllerFor } from "~/features/broadcast/broadcast-controller";
import { recordingControllerFor } from "~/features/recording/recording-controller";
import { enterRoom } from "~/features/room/enter";
import { setSessionKind, type SessionKind } from "~/features/session/session-kind";
import { useRoomController } from "~/features/session/use-room-session";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./rooms.module.css";

export const ROOM_NAME_MAX = 120;

export function StartRoom({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const t = useStrings();
  const host = useHost();
  const api = useRoomsApi();
  const viewer = useViewer();
  const { controller: rooms } = useRoomController();
  const call = useCallController();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Spec 050 AC-006: what the session is, and whether to record it (on by default for a broadcast and for just me).
  const [kind, setKind] = useState<SessionKind>("room");
  const [record, setRecord] = useState(false);
  const chooseKind = (k: SessionKind) => {
    setKind(k);
    setRecord(k !== "room");
  };
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
    setKind("room");
    setRecord(false);
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
      if (!rooms || !host) {
        host?.navigate(`/social/r/${room.id}`); // no room controller (a test page without one): the lobby
        return;
      }
      setSessionKind(room.id, kind);
      // A broadcast has its own call (spec 043): the room's call is not joined for one.
      const calls = kind !== "broadcast" && (room.calls?.available ?? false);
      await enterRoom({ roomId: room.id, owner: true, calls, rooms, call });
      if (kind === "broadcast") await broadcastControllerFor(host).start(room.id);
      if (record) await recordingControllerFor(host).start(room.id);
      chooseKind("room");
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
            <fieldset className={styles.kinds} data-session-kinds="">
              <legend className={kit.label}>{t.sessionKind}</legend>
              {(
                [
                  ["room", t.kindRoom],
                  ["broadcast", t.kindBroadcast],
                  ["recording", t.kindRecording],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className={styles.kind}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => chooseKind(k)}
                    data-session-kind={k}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className={styles.kind}>
              <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} data-record-session="" />
              {t.recordSession}
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
