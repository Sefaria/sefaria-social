import { useEffect, useState } from "react";
import { useHost, useInterfaceLang } from "~/features/host/host-context";
import { useViewer } from "~/features/host/use-viewer";
import { useRoomsApi } from "~/features/api/rooms-api";
import { useWindowOwner } from "~/features/av/WindowPrompt";
import { HostLink } from "~/features/host/HostLink";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { ReplayApiError, type RecordingMeta } from "./replay-api";
import { replayControllerFor } from "./replay-controller";
import { parseStateTrack } from "./state-track";
import { firstTextOf } from "./player";
import { formatDate, formatLength, useReplayApi, withRecordingCtx } from "./use-replay";
import styles from "./replay.module.css";
import { RecordingArtifacts } from "./RecordingArtifacts";
import assets from "./recording-artifacts.module.css";

type PageState =
  | { kind: "loading" }
  | { kind: "ready"; recording: RecordingMeta; canDelete: boolean }
  | { kind: "not-found" }
  | { kind: "deleted" };

/** The file name for a recording's state track: `sefaria-recording-<date>.json`. */
export const stateFileName = (startedAt: string | undefined) =>
  `sefaria-recording-${/^\d{4}-\d{2}-\d{2}/.exec(startedAt ?? "")?.[0] ?? "undated"}.json`;

/** Hands the viewer a file to save (a Blob behind an `<a download>`), then frees it. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * `/social/rec/$recordingId`: a recording's page (spec 042 AC-001). Its title, date and length; Play, which navigates the reader
 * to the recording's first text in its context and opens the player in the floating window (AC-002), asking first when a call
 * holds the window (AC-007); Download state, the reader's own `Recording` file; and Delete for its recorder or the room's owner.
 */
export function RecordingPage({ recordingId }: { recordingId: string }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const host = useHost();
  const viewer = useViewer();
  const api = useReplayApi();
  const rooms = useRoomsApi();
  const owner = useWindowOwner();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"play" | "download" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // Spec 053 (D2): a ready recording opens for anyone with its link; signed out, the public read answers (no delete).
    if (!api) {
      setState({ kind: "not-found" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const recording = await api.getRecording(recordingId);
        let roomOwner = false;
        if (viewer && recording.roomId && rooms) {
          const room = await rooms.getRoom(recording.roomId).catch(() => null);
          roomOwner = room?.kind === "member" && room.room.role === "owner";
        }
        const canDelete = !!viewer && (recording.canDelete === true || recording.owner?.userId === viewer.id || roomOwner);
        if (live) setState({ kind: "ready", recording, canDelete });
      } catch {
        if (live) setState({ kind: "not-found" });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, rooms, viewer, recordingId]);

  if (state.kind === "loading")
    return (
      <main data-social-page="recording" data-recording-state="loading">
        <p role="status">{t.loading}</p>
      </main>
    );
  if (state.kind === "not-found")
    return (
      <main data-social-page="recording" data-recording-state="not-found">
        <h1>{t.replayTitle}</h1>
        <p role="alert">{t.recordingNotAvailable}</p>
      </main>
    );
  if (state.kind === "deleted")
    return (
      <main data-social-page="recording" data-recording-state="deleted">
        <h1>{t.replayTitle}</h1>
        <p role="status">{t.recordingDeleted}</p>
      </main>
    );

  const { recording, canDelete } = state;
  const date = formatDate(recording.startedAt, lang);

  const play = async (at?: number) => {
    if (!host || !api) return;
    setFailed(null);
    // A call holds the window: ask first, and leave it on confirmation (AC-007).
    if (owner && !(await owner.request("replay"))) return;
    setBusy(true);
    try {
      const track = parseStateTrack(await api.getState(recordingId));
      // The first recorded text (a recording started in the lobby begins on Social's own page, which is not one).
      const first = firstTextOf(track);
      if (first) host.navigate(withRecordingCtx(first, recordingId));
      const replay = replayControllerFor(host);
      if (at == null) void replay.open(recordingId, { autoplay: true });
      else {
        await replay.open(recordingId, { autoplay: false });
        const player = replay.player();
        if (!player) throw new Error("Player unavailable");
        player.seek(at);
        await player.play();
      }
    } catch {
      setFailed("play");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!api) return;
    setFailed(null);
    try {
      const json = await api.getState(recordingId);
      save(new Blob([JSON.stringify(json)], { type: "application/json" }), stateFileName(recording.startedAt));
    } catch {
      setFailed("download");
    }
  };

  const remove = async () => {
    if (!api) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.deleteRecording(recordingId);
      setState({ kind: "deleted" });
    } catch (error) {
      if (error instanceof ReplayApiError && error.status === 404) setState({ kind: "not-found" });
      else setFailed("delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main data-social-page="recording" data-recording-state="ready" className={`${styles.page} ${assets.page}`}>
      <HostLink to="/social" className={kit.link}>
        {t.shiurBackSocial}
      </HostLink>
      {/* Spec 044 AC-007: the way back to the recording's room. */}
      {recording.roomId && (
        <p data-back-to-room="">
          <HostLink to={`/social/r/${recording.roomId}`} className={kit.link}>
            {t.backToRoomLobby}
          </HostLink>
        </p>
      )}
      <h1>
        <bdi dir="auto">{recording.title || t.recordingOf(date)}</bdi>
      </h1>
      <dl className={styles.facts}>
        <dt>{t.recordingDate}</dt>
        <dd data-recording-date="">{date}</dd>
        {recording.durationMs != null && (
          <>
            <dt>{t.recordingLength}</dt>
            <dd data-recording-length="">{formatLength(recording.durationMs)}</dd>
          </>
        )}
      </dl>
      <div className={styles.actions}>
        <button
          className={`${kit.button} ${kit.primary}`}
          type="button"
          data-action="play-recording"
          disabled={busy}
          onClick={() => void play()}
        >
          {t.play}
        </button>
        <button
          className={`${kit.button} ${kit.secondary}`}
          type="button"
          data-action="download-state"
          onClick={() => void download()}
        >
          {t.downloadState}
        </button>
        {canDelete && !confirming && (
          <button
            className={`${kit.button} ${kit.ghost}`}
            type="button"
            data-action="delete-recording"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t.deleteRecording}
          </button>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label={t.deleteRecording} data-confirm-delete="">
          <p>{t.deleteRecordingConfirm}</p>
          <button type="button" data-action="confirm-delete" disabled={busy} onClick={() => void remove()}>
            {t.deleteRecording}
          </button>
          <button type="button" data-action="cancel-delete" disabled={busy} onClick={() => setConfirming(false)}>
            {t.cancel}
          </button>
        </div>
      )}
      {failed === "play" && <p role="alert">{t.recordingCouldNotPlay}</p>}
      {failed === "download" && <p role="alert">{t.recordingNotAvailable}</p>}
      {failed === "delete" && <p role="alert">{t.recordingDeleteFailed}</p>}
      <RecordingArtifacts key={recordingId} recordingId={recordingId} onSeek={play} />
    </main>
  );
}
