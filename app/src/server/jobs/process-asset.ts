// Asset processing (spec 052; docs/plans/shiur.md 4.5, 5.1, 5.3; decision 0013). When a recording is ready its row is queued;
// the worker claims it, joins the raw chunks, remuxes them with ffmpeg into a seekable `media.webm` (cues at the front, a
// duration), extracts `audio.m4a` (what a transcript is made from), writes the reader timeline as `timeline.json` and a
// `manifest.json` (files with size and SHA-256, duration, whether there is video, chapters), then removes the raw chunks.
// Until it is done the recording still plays from the raw chunks.
//
// The queue is the row itself (decision 0013): process_status queued → running → done | failed, process_attempts, and
// process_after (a running job's lease, or a retry's backoff). Claims use FOR UPDATE SKIP LOCKED, so two workers never take
// one row; a worker that dies mid-job loses its lease and the row runs again. Every step can run twice without harm.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseStreamMessage, type StreamMessage } from "@sefaria-social/session";
import { eq, sql } from "drizzle-orm";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { sessionRecordings, userDisplay } from "../db/schema";
import { log } from "../log/logger";
import { assetKey, objectStore, recordingPrefix, type ObjectStore } from "../services/object-store";
import { postgresStore } from "../services/recording-store";
import { chaptersOf, type Chapter } from "./chapters";
import { ffmpeg, probe } from "./ffmpeg";

/** Tries before a recording's processing is given up (its raw chunks stay, and it still plays from them). */
export const PROCESS_TRIES = 3;
/** Waits before the second and third tries (ms), with up to a fifth more at random so retries do not line up. */
export const PROCESS_BACKOFF_MS = [30_000, 120_000];
/** How long a claim holds the row before another worker may take it (a worker that died). */
export const PROCESS_LEASE_MS = 15 * 60_000;
export const MANIFEST_VERSION = 1;

export interface ManifestFile {
  key: string;
  type: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  v: typeof MANIFEST_VERSION;
  id: string;
  title: string | null;
  leader: { name: string | null };
  durationMs: number;
  hasVideo: boolean;
  files: { media: ManifestFile; audio: ManifestFile | null; timeline: ManifestFile };
  chapters: Chapter[];
  transcript: { status: "none" };
  processedAt: string;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Claim the next row that may run now; null when there is none. */
export async function claimNext(db: Db = getDb()): Promise<{ id: string; attempt: number } | null> {
  const lease = sql.raw(`interval '${PROCESS_LEASE_MS / 1000} seconds'`);
  const rows = await db.execute<{ id: string; process_attempts: number }>(sql`
    update ${sessionRecordings}
       set process_status = 'running', process_attempts = process_attempts + 1, process_after = now() + ${lease}
     where id = (
       select id from ${sessionRecordings}
        where process_status in ('queued', 'running') and process_after <= now()
        order by process_after
        limit 1
        for update skip locked)
    returning id, process_attempts`);
  const row =
    (rows as unknown as { rows?: { id: string; process_attempts: number }[] }).rows?.[0] ??
    (rows as unknown as { id: string; process_attempts: number }[])[0];
  return row ? { id: row.id, attempt: Number(row.process_attempts) } : null;
}

/** Process one recording: write the processed files and the manifest, mark it done, remove the raw chunks. */
export async function processRecording(id: string, db: Db = getDb(), objects: ObjectStore = objectStore()): Promise<void> {
  const [row] = await db
    .select({ title: sessionRecordings.title, mime: sessionRecordings.mime, name: userDisplay.name })
    .from(sessionRecordings)
    .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
    .where(eq(sessionRecordings.id, id));
  if (!row) return; // deleted meanwhile: nothing to do
  const store = postgresStore(db, objects);
  const done = await objects.get(assetKey(id, "manifest.json"));
  if (!done) {
    const chunks = await store.mediaChunks(id);
    if (chunks.length === 0) throw new Error("no media to process");
    const messages = (await store.stateMessages(id))
      .map((m) => parseStreamMessage(m))
      .filter((m): m is StreamMessage => m !== null);
    const dir = await mkdtemp(path.join(tmpdir(), "social-asset-"));
    try {
      const raw = path.join(dir, "raw.webm");
      await writeFile(raw, Buffer.concat(chunks));
      const mediaFile = path.join(dir, "media.webm");
      // A MediaRecorder file has no duration and no index; a copy remux writes both, without re-encoding.
      await ffmpeg(["-y", "-fflags", "+genpts", "-i", raw, "-map", "0", "-c", "copy", "-cues_to_front", "1", mediaFile]);
      const info = await probe(mediaFile);
      let audio: ManifestFile | null = null;
      if (info.audio) {
        const audioFile = path.join(dir, "audio.m4a");
        await ffmpeg(["-y", "-i", raw, "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", audioFile]);
        const bytes = new Uint8Array(await readFile(audioFile));
        await objects.put(assetKey(id, "audio.m4a"), bytes);
        audio = { key: "audio.m4a", type: "audio/mp4", bytes: bytes.byteLength, sha256: sha256(bytes) };
      }
      const media = new Uint8Array(await readFile(mediaFile));
      await objects.put(assetKey(id, "media.webm"), media);
      const timelineBytes = new TextEncoder().encode(JSON.stringify({ v: 1, duration: info.durationMs, messages }));
      await objects.put(assetKey(id, "timeline.json"), timelineBytes);
      const { chapters, hasVideo } = chaptersOf(messages);
      const manifest: Manifest = {
        v: MANIFEST_VERSION,
        id,
        title: row.title,
        leader: { name: row.name },
        durationMs: info.durationMs,
        hasVideo,
        files: {
          media: { key: "media.webm", type: "video/webm", bytes: media.byteLength, sha256: sha256(media) },
          audio,
          timeline: {
            key: "timeline.json",
            type: "application/json",
            bytes: timelineBytes.byteLength,
            sha256: sha256(timelineBytes),
          },
        },
        chapters,
        transcript: { status: "none" },
        processedAt: new Date().toISOString(),
      };
      // The manifest last: its presence says every other file is there.
      await objects.put(assetKey(id, "manifest.json"), new TextEncoder().encode(JSON.stringify(manifest)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  await db.update(sessionRecordings).set({ processStatus: "done", processAfter: null }).where(eq(sessionRecordings.id, id));
  await objects.removePrefix(`${recordingPrefix(id)}raw/`);
}

/** After a failed try: back to the queue with a backoff, or failed after PROCESS_TRIES (the raw chunks stay). */
async function failed(db: Db, id: string, attempt: number, err: unknown): Promise<void> {
  const last = attempt >= PROCESS_TRIES;
  const wait = PROCESS_BACKOFF_MS[Math.min(attempt - 1, PROCESS_BACKOFF_MS.length - 1)]! * (1 + Math.random() * 0.2);
  log.warn("asset.process_failed", { attempt, final: last, error: err instanceof Error ? err.message.slice(0, 300) : "error" });
  await db
    .update(sessionRecordings)
    .set(
      last
        ? { processStatus: "failed", processAfter: null }
        : { processStatus: "queued", processAfter: sql`now() + ${sql.raw(`interval '${Math.round(wait)} milliseconds'`)}` },
    )
    .where(eq(sessionRecordings.id, id));
}

/** Run every row that may run now, one at a time. Returns how many were tried. */
export async function runPending(db: Db = getDb(), objects: ObjectStore = objectStore()): Promise<number> {
  let n = 0;
  for (;;) {
    const job = await claimNext(db);
    if (!job) return n;
    n++;
    try {
      await processRecording(job.id, db, objects);
      log.info("asset.processed", { attempt: job.attempt });
    } catch (err) {
      await failed(db, job.id, job.attempt, err);
    }
  }
}

// ── The worker in the server process ─────────────────────────────────────────────────────────────────────────────────

export const WORKER_INTERVAL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;

const workerOn = () => getConfig().ASSET_WORKER !== "off";

/** Run the queue now (unless a run is going), in the background. */
export function kickAssetWorker(): void {
  if (!workerOn() || running) return;
  running = runPending()
    .catch((err: unknown) => log.error("asset.worker_failed", { error: err instanceof Error ? err.message : "error" }))
    .finally(() => {
      running = null;
    });
}

/**
 * Start the worker's timer once per process (spec 052 AC-006): called from the health check, which the platform calls from
 * the moment the server starts, and whenever a recording is finished. ASSET_WORKER=off (tests) leaves it off.
 */
export function ensureAssetWorker(): void {
  if (timer || !workerOn()) return;
  timer = setInterval(kickAssetWorker, WORKER_INTERVAL_MS);
  timer.unref?.();
  kickAssetWorker();
}
