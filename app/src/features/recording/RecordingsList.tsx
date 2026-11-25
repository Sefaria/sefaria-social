import { useEffect, useState } from "react";
import { HostLink } from "~/features/host/HostLink";
import { useInterfaceLang } from "~/features/host/host-context";
import type { RecordingMeta } from "~/features/replay/replay-api";
import { formatDate, formatLength, useReplayApi } from "~/features/replay/use-replay";
import { useStrings } from "~/features/shell/use-strings";
import styles from "./recording.module.css";

/** Ready recordings, newest first. */
function readyNewestFirst(list: RecordingMeta[]): RecordingMeta[] {
  return list
    .filter((r) => r.status === "ready")
    .sort((a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? "") || 0);
}

/**
 * The room's recordings in its lobby (spec 042 AC-001): ready ones, newest first, each with its title (or "Recording of
 * <date>"), date and length, linking to its page `/social/rec/<id>`. Nothing while there are none, or when they cannot be read.
 */
export function RecordingsList({ roomId }: { roomId: string }) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const api = useReplayApi();
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.listRecordings(roomId).then(
      (list) => live && setRecordings(readyNewestFirst(list)),
      () => live && setRecordings([]),
    );
    return () => {
      live = false;
    };
  }, [api, roomId]);

  if (!recordings.length) return null;
  return (
    <section aria-label={t.recordings} data-recordings="" className={styles.list}>
      <h2>{t.recordings}</h2>
      <ul>
        {recordings.map((r) => {
          const date = formatDate(r.startedAt, lang);
          return (
            <li key={r.id} data-recording-id={r.id}>
              <HostLink to={`/social/rec/${r.id}`}>
                <bdi dir="auto">{r.title || t.recordingOf(date)}</bdi>
              </HostLink>{" "}
              <span data-recording-date="">{date}</span>{" "}
              {r.durationMs != null && <span data-recording-length="">{formatLength(r.durationMs)}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
