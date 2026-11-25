// A shiur's transcript (spec 054; docs/plans/shiur.md 5.4; D10): once a recording is processed (spec 052) its audio goes to
// Sofer.ai in the language the leader chose; the job polls until the transcript is done (Sofer.ai has no webhook), then keeps
// its words with their times as `transcript.json` and cues as `transcript.vtt` beside the asset, and marks the manifest. Without
// a key it is "unavailable" and everything else works; a Sofer.ai failure is "failed" and never touches the asset.
//
// The same queue as processing (decision 0013), on its own columns: transcript_status queued → submitted → ready | failed,
// transcript_attempts, transcript_after (when it may run next). Each call to Sofer.ai has a time limit; a poll waits 30 s, growing
// to 5 minutes; after 6 hours, or 3 failed submissions, it is failed. Sofer.ai allows 5 requests a minute: one job at a time.
import { eq, sql } from "drizzle-orm";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { sessionRecordings } from "../db/schema";
import { log } from "../log/logger";
import { assetKey, objectStore, type ObjectStore } from "../services/object-store";

export const TRANSCRIPT_LANGUAGES = ["en", "he", "yi", "fr"] as const;
export type TranscriptLanguage = (typeof TRANSCRIPT_LANGUAGES)[number];
export const SUBMIT_TRIES = 3;
export const POLL_FIRST_MS = 30_000;
export const POLL_MAX_MS = 5 * 60_000;
export const GIVE_UP_MS = 6 * 60 * 60_000;
export const CALL_TIMEOUT_MS = 30_000;
/** Above this the audio goes by URL only (base64 in the request body grows it by a third). */
export const MAX_INLINE_AUDIO_BYTES = 40 * 1024 * 1024;

export interface TranscriptWord {
  w: string;
  /** ms */
  s: number;
  e: number;
}

export interface TranscriptDoc {
  v: 1;
  language: TranscriptLanguage;
  text: string;
  words: TranscriptWord[];
}

/** What a Sofer.ai answer may say; anything else is not trusted. */
type SoferStatus =
  "RECEIVED" | "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "FAILED" | "UPLOADED" | "INSUFFICIENT_FUNDS";
const DONE_BAD = new Set(["CANCELLED", "FAILED", "INSUFFICIENT_FUNDS"]);

/** The request Sofer.ai gets: English with Hebrew words in Hebrew letters by default (D10); other languages as they are. */
export function soferRequest(language: TranscriptLanguage, title: string | null, audio: { url: string } | { base64: string }) {
  return {
    ...("url" in audio ? { audio_url: audio.url } : { audio_file: audio.base64 }),
    info: {
      title: (title || "Shiur").slice(0, 200),
      primary_language: language,
      ...(language === "en" ? { hebrew_word_format: ["he"] } : {}),
      num_speakers: 1,
    },
  };
}

/** WebVTT cues of at most 8 words or 5 seconds each. */
export function toVtt(words: readonly TranscriptWord[]): string {
  const stamp = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor(ms / 60_000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const f = Math.floor(ms % 1000);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(h)}:${two(m)}:${two(s)}.${String(f).padStart(3, "0")}`;
  };
  const cues: string[] = [];
  let cue: TranscriptWord[] = [];
  const flush = () => {
    if (!cue.length) return;
    const text = cue
      .map((w) => w.w)
      .join(" ")
      .replace(/-->/g, "→");
    cues.push(`${stamp(cue[0]!.s)} --> ${stamp(cue.at(-1)!.e)}\n${text}`);
    cue = [];
  };
  for (const w of words) {
    if (cue.length && (cue.length >= 8 || w.e - cue[0]!.s > 5_000)) flush();
    cue.push(w);
  }
  flush();
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

async function sofer(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const { SOFER_API_KEY: key, SOFER_API_URL: base } = getConfig();
  const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sofer ${init.method ?? "GET"} ${path.split("/").slice(0, 3).join("/")} answered ${res.status}`);
  return res.json();
}

/** Claim the next transcript job that may run now. */
async function claim(db: Db): Promise<{ id: string; status: string; jobId: string | null; attempts: number } | null> {
  const rows = (await db.execute(sql`
    update ${sessionRecordings}
       set transcript_after = now() + interval '10 minutes'
     where id = (
       select id from ${sessionRecordings}
        where transcript_status in ('queued', 'submitted') and transcript_after <= now()
        order by transcript_after
        limit 1
        for update skip locked)
    returning id, transcript_status, transcript_job_id, transcript_attempts`)) as unknown as
    { rows: Record<string, unknown>[] } | Record<string, unknown>[];
  const row = (Array.isArray(rows) ? rows : rows.rows)[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.transcript_status),
    jobId: row.transcript_job_id === null ? null : String(row.transcript_job_id),
    attempts: Number(row.transcript_attempts),
  };
}

const later = (ms: number) => sql`now() + ${sql.raw(`interval '${Math.round(ms)} milliseconds'`)}`;

async function setTranscript(db: Db, id: string, set: Record<string, unknown>) {
  await db.update(sessionRecordings).set(set).where(eq(sessionRecordings.id, id));
}

/** Mark the manifest (spec 052) with the transcript's state; the manifest stays the record of what the asset holds. */
async function markManifest(objects: ObjectStore, id: string, transcript: Record<string, unknown>) {
  const key = assetKey(id, "manifest.json");
  const bytes = await objects.get(key);
  if (!bytes) return;
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  await objects.put(key, new TextEncoder().encode(JSON.stringify({ ...manifest, transcript })));
}

/** Submit a queued recording's audio. */
async function submit(db: Db, objects: ObjectStore, id: string, attempts: number): Promise<void> {
  const [row] = await db
    .select({ title: sessionRecordings.title, language: sessionRecordings.transcriptLanguage })
    .from(sessionRecordings)
    .where(eq(sessionRecordings.id, id));
  if (!row) return;
  const language = (TRANSCRIPT_LANGUAGES as readonly string[]).includes(row.language)
    ? (row.language as TranscriptLanguage)
    : "en";
  const origin = getConfig().SOCIAL_PUBLIC_ORIGIN;
  let audio: { url: string } | { base64: string };
  if (origin) audio = { url: `${origin.replace(/\/+$/, "")}/api/v1/assets/${id}/audio` };
  else {
    const bytes = await objects.get(assetKey(id, "audio.m4a"));
    if (!bytes) throw new Error("no audio to transcribe");
    if (bytes.byteLength > MAX_INLINE_AUDIO_BYTES) throw new Error("audio too large to send inline");
    audio = { base64: Buffer.from(bytes).toString("base64") };
  }
  const jobId = await sofer("/v1/transcriptions/", { method: "POST", body: soferRequest(language, row.title, audio) });
  if (typeof jobId !== "string" || !jobId) throw new Error("sofer gave no transcription id");
  await setTranscript(db, id, {
    transcriptStatus: "submitted",
    transcriptJobId: jobId.slice(0, 200),
    transcriptSubmittedAt: sql`now()`,
    transcriptAttempts: 0,
    transcriptAfter: later(POLL_FIRST_MS),
  });
  await markManifest(objects, id, { status: "running", language });
  void attempts;
}

/** Ask a submitted transcript's status; keep it when done. */
async function poll(db: Db, objects: ObjectStore, id: string, jobId: string, polls: number): Promise<void> {
  const [row] = await db
    .select({ language: sessionRecordings.transcriptLanguage, submittedAt: sessionRecordings.transcriptSubmittedAt })
    .from(sessionRecordings)
    .where(eq(sessionRecordings.id, id));
  if (!row) return;
  const info = (await sofer(`/v1/transcriptions/${encodeURIComponent(jobId)}/status`)) as { status?: SoferStatus };
  const status = String(info?.status ?? "");
  if (status === "COMPLETED") {
    const result = (await sofer(`/v1/transcriptions/${encodeURIComponent(jobId)}`)) as {
      text?: unknown;
      timestamps?: { word?: unknown; start?: unknown; end?: unknown }[];
    };
    const words: TranscriptWord[] = (Array.isArray(result?.timestamps) ? result.timestamps : [])
      .filter((t) => typeof t?.word === "string" && typeof t.start === "number" && typeof t.end === "number")
      .map((t) => ({
        w: (t.word as string).slice(0, 200),
        s: Math.round((t.start as number) * 1000),
        e: Math.round((t.end as number) * 1000),
      }));
    const doc: TranscriptDoc = {
      v: 1,
      language: row.language as TranscriptLanguage,
      text: typeof result?.text === "string" ? result.text : words.map((w) => w.w).join(" "),
      words,
    };
    await objects.put(assetKey(id, "transcript.json"), new TextEncoder().encode(JSON.stringify(doc)));
    await objects.put(assetKey(id, "transcript.vtt"), new TextEncoder().encode(toVtt(words)));
    await markManifest(objects, id, { status: "ready", language: doc.language, words: words.length });
    await setTranscript(db, id, { transcriptStatus: "ready", transcriptAfter: null });
    log.info("transcript.ready", { words: words.length });
    return;
  }
  const waited = row.submittedAt ? Date.now() - row.submittedAt.getTime() : 0;
  if (DONE_BAD.has(status) || waited > GIVE_UP_MS) {
    await markManifest(objects, id, { status: "failed", language: row.language });
    await setTranscript(db, id, { transcriptStatus: "failed", transcriptAfter: null });
    log.warn("transcript.failed", { reason: DONE_BAD.has(status) ? status.toLowerCase() : "timeout" });
    return;
  }
  const wait = Math.min(POLL_MAX_MS, POLL_FIRST_MS * 1.5 ** polls);
  await setTranscript(db, id, { transcriptAttempts: polls + 1, transcriptAfter: later(wait) });
}

/** Run every transcript job that may run now, one at a time. Returns how many were tried. */
export async function runTranscripts(db: Db = getDb(), objects: ObjectStore = objectStore()): Promise<number> {
  let n = 0;
  for (;;) {
    const job = await claim(db);
    if (!job) return n;
    n++;
    try {
      if (!getConfig().SOFER_API_KEY) {
        await setTranscript(db, job.id, { transcriptStatus: "unavailable", transcriptAfter: null });
        continue;
      }
      if (job.status === "queued") await submit(db, objects, job.id, job.attempts);
      else if (job.jobId) await poll(db, objects, job.id, job.jobId, job.attempts);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : "error";
      if (job.status === "queued") {
        const attempts = job.attempts + 1;
        const last = attempts >= SUBMIT_TRIES;
        log.warn("transcript.submit_failed", { attempt: attempts, final: last, error: message });
        await setTranscript(
          db,
          job.id,
          last
            ? { transcriptStatus: "failed", transcriptAfter: null, transcriptAttempts: attempts }
            : { transcriptAttempts: attempts, transcriptAfter: later(POLL_FIRST_MS * attempts * (1 + Math.random() * 0.2)) },
        );
        if (last) await markManifest(objects, job.id, { status: "failed" }).catch(() => undefined);
      } else {
        // A poll that failed (network, 5xx): try again later; the 6-hour limit still ends it.
        log.warn("transcript.poll_failed", { error: message });
        await setTranscript(db, job.id, { transcriptAfter: later(POLL_MAX_MS) });
      }
    }
  }
}
