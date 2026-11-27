import { useEffect, useId, useState, useRef } from "react";
import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { useInterfaceLang } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import type { AssetManifest, AssetTranscript } from "./replay-api";
import { transcriptLines } from "./ReplayBar";
import { formatLength, useReplayApi } from "./use-replay";
import styles from "./recording-artifacts.module.css";
import { isRecordedText } from "~/lib/recorded-text";
import { ClassWorkspace } from "./ClassWorkspace";

/** The existing recording assets, revisited after a shiur (spec 061). */
export function RecordingArtifacts({ recordingId, onSeek }: { recordingId: string; onSeek: (ms: number) => Promise<void> }) {
  const api = useReplayApi();
  const t = useStrings();
  const lang = useInterfaceLang();
  const searchId = useId();
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  const [transcript, setTranscript] = useState<AssetTranscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const journey = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const transcriptSection = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setFailed(false);
    setManifest(null);
    setTranscript(null);
    async function load() {
      try {
        const next = (await api?.getManifest?.(recordingId)) ?? null;
        if (!live) return;
        setManifest(next);
        if (next?.transcript?.status === "ready" && api?.getTranscript) {
          const words = await api.getTranscript(recordingId);
          if (live) setTranscript(words);
        }
        const pending =
          !next || ["pending", "queued", "submitted", "running", "processing"].includes(next.transcript?.status ?? "");
        if (live && pending && api?.getManifest && attempt < 20) timer = setTimeout(() => setAttempt((n) => n + 1), 5000);
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, recordingId, attempt]);

  const chapters = (manifest?.chapters ?? []).filter((chapter) => isRecordedText(chapter.ref)).sort((a, b) => a.t - b.t);
  const sources = [...new Map(chapters.map((chapter) => [chapter.ref, chapter])).values()];
  const lines = transcriptLines(transcript?.words ?? []);
  const matching = lines.filter((line) =>
    line
      .map((word) => word.w)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className={styles.assets}>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>{t.shiurClassMaterials}</p>
          <h2>{t.shiurRevisit}</h2>
        </div>
        {manifest && <p className={styles.muted}>{t.shiurSourceCount(sources.length, chapters.length)}</p>}
      </div>
      {manifest && (
        <nav className={styles.sectionNav} aria-label={t.shiurOnThisPage}>
          <button type="button" onClick={() => journey.current?.scrollIntoView({ block: "start" })}>
            {t.shiurItinerary}
          </button>
          <button type="button" onClick={() => workspace.current?.scrollIntoView({ block: "start" })}>
            {t.shiurTextsMargins}
          </button>
          <button type="button" onClick={() => transcriptSection.current?.scrollIntoView({ block: "start" })}>
            {t.shiurTranscript}
          </button>
        </nav>
      )}
      {loading && (
        <p role="status" data-assets-loading="">
          {t.loading}
        </p>
      )}
      {failed && (
        <div role="alert">
          <p>{t.shiurLoadFailed}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t.shiurRetry}
          </button>
        </div>
      )}
      {!loading && !failed && !manifest && <p role="status">{attempt < 20 ? t.shiurPreparing : t.shiurUnavailable}</p>}
      {!loading && !failed && !manifest && attempt >= 20 && (
        <button type="button" onClick={() => setAttempt(0)}>
          {t.shiurRetry}
        </button>
      )}
      {manifest && (
        <>
          <section ref={journey} className={styles.section} aria-label={t.shiurItinerary}>
            <h3>{t.shiurItinerary}</h3>
            <p>{t.shiurItineraryHint}</p>
            {chapters.length ? (
              <ol className={styles.itinerary}>
                {chapters.map((chapter, index) => (
                  <li data-chapter="" key={`${chapter.t}-${index}`}>
                    <span className={styles.stopNumber}>{String(index + 1).padStart(2, "0")}</span>
                    <button
                      type="button"
                      onClick={() => void onSeek(chapter.t)}
                      aria-label={`${t.play} ${formatLength(chapter.t)}`}
                    >
                      {formatLength(chapter.t)}
                    </button>
                    <ReaderRefLink textRef={chapter.ref} beside>
                      <bdi>{lang === "hebrew" ? chapter.heRef || chapter.ref : chapter.ref}</bdi>
                    </ReaderRefLink>
                    <button
                      type="button"
                      className={styles.readAction}
                      onClick={() => {
                        setSelected(sources.findIndex((source) => source.ref === chapter.ref));
                        workspace.current?.scrollIntoView({ block: "start" });
                      }}
                    >
                      {t.shiurReadHere}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t.shiurNoTexts}</p>
            )}
          </section>
          <section ref={workspace} className={styles.section} aria-label={t.shiurTextsMargins}>
            <p className={styles.eyebrow}>{t.shiurSharedReading}</p>
            <h2>{t.shiurTextsMargins}</h2>
            <p className={styles.muted}>{t.shiurWorkspaceHint}</p>
            <ClassWorkspace sources={sources} selected={selected} onSelect={setSelected} />
          </section>
          <section className={styles.section} data-bibliography="" aria-label={t.shiurSources}>
            <h3>{t.shiurSources}</h3>
            <ul className={styles.bibliography}>
              {sources.map((source) => (
                <li key={source.ref}>
                  <ReaderRefLink textRef={source.ref} beside>
                    <bdi>{lang === "hebrew" ? source.heRef || source.ref : source.ref}</bdi>
                  </ReaderRefLink>
                </li>
              ))}
            </ul>
          </section>
          <details className={styles.moreMaterials}>
            <summary>{t.shiurFurtherMaterials}</summary>
            <div className={styles.synthesisGrid}>
              {[
                [t.shiurOverview, t.shiurNoSummary],
                [t.shiurChiddushim, t.shiurNoInsights],
                [t.shiurQuestions, t.shiurNoQuestions],
                [t.shiurContinue, t.shiurNoNext],
              ].map(([title, description]) => (
                <section key={title}>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </section>
              ))}
            </div>
          </details>
          <section ref={transcriptSection} className={styles.section} aria-label={t.shiurTranscript}>
            <p className={styles.eyebrow}>{t.shiurConversation}</p>
            <h3>{t.shiurTranscript}</h3>
            {transcript ? (
              <>
                <label htmlFor={searchId}>{t.shiurSearch}</label>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={styles.search}
                />
                <div className={styles.transcript}>
                  {matching.map((line, index) => (
                    <p data-transcript-line="" key={`${line[0]!.s}-${index}`}>
                      <button
                        type="button"
                        onClick={() => void onSeek(line[0]!.s)}
                        aria-label={`${t.play} ${formatLength(line[0]!.s)}`}
                      >
                        {formatLength(line[0]!.s)}
                      </button>
                      <bdi dir="auto">{line.map((word) => word.w).join(" ")}</bdi>
                    </p>
                  ))}
                  {!matching.length && <p>{t.shiurNoMatches}</p>}
                </div>
              </>
            ) : (
              <p role="status">
                {loading
                  ? t.loading
                  : failed
                    ? t.shiurTranscriptLoadFailed
                    : ["queued", "submitted", "pending", "running", "processing"].includes(manifest.transcript?.status ?? "")
                      ? t.shiurTranscriptPreparing
                      : manifest.transcript?.status === "failed"
                        ? t.shiurTranscriptFailed
                        : t.shiurTranscriptUnavailable}
              </p>
            )}
            {!transcript &&
              !loading &&
              !failed &&
              attempt >= 20 &&
              ["queued", "submitted", "pending", "running", "processing"].includes(manifest.transcript?.status ?? "") && (
                <button type="button" onClick={() => setAttempt(0)}>
                  {t.shiurRetry}
                </button>
              )}
          </section>
        </>
      )}
    </div>
  );
}
