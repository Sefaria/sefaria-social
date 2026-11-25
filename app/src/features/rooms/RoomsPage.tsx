// `/social/rooms` (spec 044 AC-002): every room the viewer is a member of, newest first, each saying whether they own it and
// linking to its lobby, with Start a room. After a room is deleted or left, the one-shot notice says so. Signed out, it asks the
// reader to sign the person in (R17) and requests nothing.
import { useEffect, useState } from "react";
import { useHost } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { HostLink } from "~/features/host/HostLink";
import { useRoomsApi, type Room } from "~/features/api/rooms-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { takeRoomsNotice } from "./notice";
import { StartRoom } from "./StartRoom";
import styles from "./rooms.module.css";

type State = { kind: "loading" } | { kind: "ready"; rooms: Room[] } | { kind: "error" };

export function RoomsPage() {
  const t = useStrings();
  const host = useHost();
  const api = useRoomsApi();
  const viewer = useViewer();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice] = useState(() => takeRoomsNotice());
  const signedIn = Boolean(viewer && api);

  useEffect(() => {
    if (!signedIn || !api?.list) return;
    let live = true;
    api.list().then(
      (rooms) => live && setState({ kind: "ready", rooms }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, signedIn]);

  return (
    <main className={styles.page} data-social-page="rooms" data-rooms-state={signedIn ? state.kind : "signed-out"}>
      <header className={styles.header}>
        <h1>{t.yourRooms}</h1>
        {signedIn && <StartRoom />}
      </header>
      {notice && (
        <p role="status" className={styles.notice} data-rooms-notice="">
          {notice}
        </p>
      )}
      {!signedIn ? (
        <section className={kit.empty}>
          <p className={kit.emptyTitle}>{t.roomsSignedOut}</p>
          <button
            type="button"
            className={`${kit.button} ${kit.primary}`}
            onClick={() => host?.viewer.requestSignIn()}
            data-action="sign-in"
          >
            {t.signIn}
          </button>
        </section>
      ) : state.kind === "loading" ? (
        <p role="status">{t.loading}</p>
      ) : state.kind === "error" ? (
        <p role="alert">{t.roomsError}</p>
      ) : state.rooms.length === 0 ? (
        <section className={kit.empty} data-rooms-empty="">
          <p className={kit.emptyTitle}>{t.noRoomsYet}</p>
          <p className={kit.emptyBody}>{t.noRoomsBody}</p>
        </section>
      ) : (
        <ul className={styles.list}>
          {state.rooms.map((room) => (
            <li key={room.id} className={styles.row} data-room-row={room.id}>
              <HostLink to={`/social/r/${room.id}`} className={styles.rowLink}>
                <bdi dir="auto">{room.title}</bdi>
              </HostLink>
              <span className={kit.badge} data-room-role={room.role}>
                {room.role === "owner" ? t.roleOwner : t.roleMember}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
