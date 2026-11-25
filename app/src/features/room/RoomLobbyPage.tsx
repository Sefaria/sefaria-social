import { useCallback, useEffect, useState } from "react";
import { useHost } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useRoomsApi, type Room } from "~/features/api/rooms-api";
import { useStrings } from "~/features/shell/use-strings";
import { PresenceList } from "~/features/presence/PresenceList";
import { CallButton } from "~/features/av/CallButton";
import { BroadcastPanel } from "~/features/broadcast/BroadcastPanel";
import { RecordButton } from "~/features/recording/RecordButton";
import { RecordingsList } from "~/features/recording/RecordingsList";
import { isRecordingFlag, recordingHere, useRecordingController, useRecordingView } from "~/features/recording/use-recording";
import { useRoomController, useRoomHold } from "~/features/session/use-room-session";
import kit from "~/ui/kit.module.css";
import { InvitePanel } from "./InvitePanel";
import { RoomSettings } from "./RoomSettings";
import styles from "./lobby.module.css";

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
  const [onCall, setOnCall] = useState<number | null>(null);
  const [statusRecording, setStatusRecording] = useState(false);
  const recordingView = useRecordingView(useRecordingController());
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

  // Who is on the room's call (spec 038): read with the status once the viewer is a member.
  useEffect(() => {
    if (state.kind !== "member" || !api?.getStatus) return;
    let live = true;
    api.getStatus(roomId).then(
      (s) => {
        if (!live) return;
        setOnCall(s?.call?.live ? s.call.participants : null);
        setStatusRecording(isRecordingFlag(s));
      },
      () => live && setOnCall(null),
    );
    return () => {
      live = false;
    };
  }, [api, roomId, state.kind]);

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

  // While the room is being recorded everyone in it is told (spec 041 AC-006): from the room read, its status, or this browser.
  const recording =
    state.kind === "member" && (isRecordingFlag(state.room) || statusRecording || recordingHere(recordingView, roomId));

  const owner = state.kind === "member" && state.room.role === "owner";

  // Spec 044: a member's lobby is a header (title, whether they own the room), the main actions (Enter the room, the call), what
  // is happening now, then cards — Invite people, the owner's session tools, who is here, recordings, room settings.
  return (
    <main data-social-page="room" data-room-state={state.kind} className={styles.page}>
      {state.kind === "member" ? (
        <header className={styles.header}>
          <h1>
            <bdi dir="auto">{state.room.title}</bdi>
          </h1>
          <p className={styles.role} data-room-role={state.room.role}>
            {owner ? t.youOwnRoom : t.youAreMember}
          </p>
        </header>
      ) : (
        <>
          <h1>{t.room}</h1>
          <p>
            {t.roomId}: <bdi>{roomId}</bdi>
          </p>
        </>
      )}
      {state.kind === "loading" && <p role="status">{t.loading}</p>}
      {state.kind === "outsider" && (
        <section aria-label={t.joinRoom} className={styles.card}>
          <p>{t.invited}</p>
          <div className={styles.actions}>
            <button type="button" onClick={join} disabled={joining} data-action="join" className={`${kit.button} ${kit.primary}`}>
              {t.join}
            </button>
          </div>
        </section>
      )}
      {state.kind === "member" && (
        <>
          <div className={styles.primary}>
            <button
              type="button"
              data-action="enter"
              className={`${kit.button} ${kit.primary}`}
              onClick={() => void controller?.enlarge(roomId)}
            >
              {t.enter}
            </button>
            <CallButton roomId={roomId} available={state.room.calls?.available ?? false} />
          </div>
          {(recording || onCall !== null) && (
            <div className={styles.status}>
              {recording && (
                <p role="status" data-room-recording="" className={kit.badge}>
                  {t.recording}
                </p>
              )}
              {onCall !== null && (
                <p data-call-count="" className={kit.badge}>
                  {t.onCall(onCall)}
                </p>
              )}
            </div>
          )}
          <InvitePanel roomId={roomId} title={state.room.title} />
          {owner && (
            <section className={styles.card} aria-labelledby="social-owner-tools" data-owner-tools="">
              <h2 id="social-owner-tools" className={styles.cardTitle}>
                {t.ownerTools}
              </h2>
              <p className={kit.hint}>{t.ownerToolsHint}</p>
              <RecordButton roomId={roomId} />
              <BroadcastPanel roomId={roomId} live={state.room.broadcast} />
            </section>
          )}
          <PresenceList roomId={roomId} />
          <RecordingsList roomId={roomId} />
          <RoomSettings room={state.room} onRenamed={(room) => setState({ kind: "member", room })} />
        </>
      )}
      {state.kind === "not-found" && <p role="alert">{t.roomNotFound}</p>}
      {state.kind === "error" && <p role="alert">{t.roomError}</p>}
    </main>
  );
}
