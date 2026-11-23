import { useCallback, useEffect, useState } from "react";
import { useHost } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useRoomsApi, type Room } from "~/features/api/rooms-api";
import { useStrings } from "~/features/shell/use-strings";
import { PresenceList } from "~/features/presence/PresenceList";
import { useRoomController, useRoomHold } from "~/features/session/use-room-session";

type LobbyState =
  | { kind: "loading" }
  | { kind: "member"; room: Room }
  | { kind: "outsider" } // signed out, or not a member yet (the API does not say which room it is)
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * `/social/r/$roomId`: the room lobby (R6, R8 — the room's shareable address). A member sees the room; anyone else sees Join,
 * because holding the link is the invitation (spec 011). A signed-out viewer pressing Join is sent to the reader's sign-in
 * (R17), never to a login URL.
 */
export function RoomLobbyPage({ roomId }: { roomId: string }) {
  const t = useStrings();
  const host = useHost();
  const api = useRoomsApi();
  const viewer = useViewer();
  const [state, setState] = useState<LobbyState>({ kind: "loading" });
  const [joining, setJoining] = useState(false);
  const { controller } = useRoomController();
  // A member's lobby holds the room's connection open (spec 012): who is here, live.
  useRoomHold(roomId, "lobby", state.kind === "member");

  useEffect(() => {
    let live = true;
    if (!api || !viewer) {
      setState({ kind: "outsider" });
      return;
    }
    setState({ kind: "loading" });
    api.getRoom(roomId).then(
      (r) => live && setState(r.kind === "member" ? { kind: "member", room: r.room } : { kind: "outsider" }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, viewer, roomId]);

  const join = useCallback(async () => {
    if (!viewer || !api) {
      host?.viewer.requestSignIn();
      return;
    }
    setJoining(true);
    try {
      const r = await api.join(roomId);
      setState(r.kind === "joined" ? { kind: "member", room: r.room } : { kind: "not-found" });
    } catch {
      setState({ kind: "error" });
    } finally {
      setJoining(false);
    }
  }, [api, host, roomId, viewer]);

  return (
    <main data-social-page="room" data-room-state={state.kind}>
      {state.kind === "member" ? (
        <h1>
          <bdi dir="auto">{state.room.title}</bdi>
        </h1>
      ) : (
        <h1>{t.room}</h1>
      )}
      <p>
        {t.roomId}: <bdi>{roomId}</bdi>
      </p>
      {state.kind === "loading" && <p role="status">{t.loading}</p>}
      {state.kind === "outsider" && (
        <section aria-label={t.joinRoom}>
          <p>{t.invited}</p>
          <button type="button" onClick={join} disabled={joining} data-action="join">
            {t.join}
          </button>
        </section>
      )}
      {state.kind === "member" && (
        <>
          <button type="button" data-action="enter" onClick={() => void controller?.enlarge(roomId)}>
            {t.enter}
          </button>
          <PresenceList roomId={roomId} />
        </>
      )}
      {state.kind === "not-found" && <p role="alert">{t.roomNotFound}</p>}
      {state.kind === "error" && <p role="alert">{t.roomError}</p>}
    </main>
  );
}
