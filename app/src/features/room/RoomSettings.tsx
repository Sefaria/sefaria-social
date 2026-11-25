// Room settings (spec 044 AC-004 – AC-006). The owner renames the room in place and can delete it after a confirmation that says
// its recordings go with it; a member can leave it after a confirmation. Deleting or leaving first closes any session of the room
// in this browser (the room controller's leave also ends its call, spec 034), then opens /social/rooms with a one-shot notice.
import { useState, type FormEvent } from "react";
import { useHost } from "~/features/host/host-context";
import { useRoomsApi, type Room } from "~/features/api/rooms-api";
import { useRoomController } from "~/features/session/use-room-session";
import { setRoomsNotice } from "~/features/rooms/notice";
import { ROOM_NAME_MAX } from "~/features/rooms/StartRoom";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./lobby.module.css";

type Confirming = null | "delete" | "leave";
type Failure = null | "rename" | "delete" | "leave";

export function RoomSettings({ room, onRenamed }: { room: Room; onRenamed: (room: Room) => void }) {
  const t = useStrings();
  const host = useHost();
  const api = useRoomsApi();
  const { controller } = useRoomController();
  const owner = room.role === "owner";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.title);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [failed, setFailed] = useState<Failure>(null);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const title = name.trim();
    if (!title || !api?.rename) return;
    setBusy(true);
    setFailed(null);
    try {
      onRenamed(await api.rename(room.id, title));
      setEditing(false);
    } catch {
      setFailed("rename");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (kind: "delete" | "leave") => {
    const call = kind === "delete" ? api?.remove : api?.leave;
    if (!call) return;
    setBusy(true);
    setFailed(null);
    try {
      controller?.leave(room.id);
      await call(room.id);
      setRoomsNotice(kind === "delete" ? t.roomDeleted(room.title) : t.roomLeft(room.title));
      host?.navigate("/social/rooms");
    } catch {
      setFailed(kind);
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="social-room-settings" data-room-settings="">
      <h2 id="social-room-settings" className={styles.cardTitle}>
        {t.roomSettings}
      </h2>
      {owner &&
        (editing ? (
          <form className={styles.renameForm} onSubmit={(e) => void rename(e)} data-rename-form="">
            <label className={kit.field}>
              <span className={kit.label}>{t.roomName}</span>
              <input
                className={kit.input}
                value={name}
                maxLength={ROOM_NAME_MAX}
                dir="auto"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                data-rename-input=""
              />
            </label>
            <div className={styles.actions}>
              <button
                type="submit"
                className={`${kit.button} ${kit.primary} ${kit.small}`}
                disabled={busy || name.trim() === ""}
                data-action="save-rename"
              >
                {busy ? t.saving : t.save}
              </button>
              <button
                type="button"
                className={`${kit.button} ${kit.ghost} ${kit.small}`}
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setName(room.title);
                  setFailed(null);
                }}
                data-action="cancel-rename"
              >
                {t.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={`${kit.button} ${kit.secondary} ${kit.small}`}
              onClick={() => {
                setName(room.title);
                setEditing(true);
              }}
              data-action="rename-room"
            >
              {t.rename}
            </button>
            {confirming !== "delete" && (
              <button
                type="button"
                className={`${kit.button} ${kit.ghost} ${kit.small} ${styles.dangerText}`}
                onClick={() => setConfirming("delete")}
                data-action="delete-room"
              >
                {t.deleteRoom}
              </button>
            )}
          </div>
        ))}
      {!owner && confirming !== "leave" && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${kit.button} ${kit.secondary} ${kit.small}`}
            onClick={() => setConfirming("leave")}
            data-action="leave-room"
          >
            {t.leaveRoom}
          </button>
        </div>
      )}
      {confirming && (
        <div
          role="group"
          aria-label={confirming === "delete" ? t.deleteRoom : t.leaveRoom}
          className={styles.confirm}
          data-confirm={confirming}
        >
          <p>{confirming === "delete" ? t.deleteRoomConfirm(room.title) : t.leaveRoomConfirm(room.title)}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${kit.button} ${kit.danger} ${kit.small}`}
              disabled={busy}
              onClick={() => void finish(confirming)}
              data-action={confirming === "delete" ? "confirm-delete-room" : "confirm-leave-room"}
            >
              {confirming === "delete" ? t.deleteRoom : t.leaveRoom}
            </button>
            <button
              type="button"
              className={`${kit.button} ${kit.ghost} ${kit.small}`}
              disabled={busy}
              onClick={() => setConfirming(null)}
              data-action="cancel-confirm"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {failed && (
        <p role="alert" className={styles.error}>
          {failed === "rename" ? t.renameFailed : failed === "delete" ? t.deleteRoomFailed : t.leaveRoomFailed}
        </p>
      )}
      <p className={styles.roomId}>
        {t.roomId}: <bdi>{room.id}</bdi>
      </p>
    </section>
  );
}
