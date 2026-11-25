// Asset processing (spec 052; docs/plans/shiur.md 4.5, 5.1, 5.3; decision 0013). When a recording is ready its row is queued;
// the worker claims it, writes the raw chunks to a temporary file one at a time, remuxes them with ffmpeg into a seekable
// `media.webm` (cues at the front, a duration), extracts `audio.m4a` (what a transcript is made from), writes the reader
// timeline as `timeline.json` and a `manifest.json` (files with size and SHA-256, duration, whether there is video, chapters),
// then removes the raw chunks. Until it is done the recording still plays from the raw chunks. No step holds a recording
// whole in memory: chunks go to disk one by one, and the processed files are copied and hashed as streams.
//
// The queue is the row itself (decision 0013): process_status queued → running → done | failed, process_attempts, and
// process_after (a running job's lease, or a retry's backoff). Claims use FOR UPDATE SKIP LOCKED, so two workers never take
// one row. A claim is the attempt number: a job writes its result only while the row still holds that attempt, so a job that
// outlived its lease never overwrites the one that took over. A row whose attempts are spent is failed when its lease runs
// out, even if the worker died without catching an error (an out-of-memory kill), so a recording cannot crash-loop the server.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseStreamMessage, type StreamMessage } from "@sefaria-social/session";
import { and, eq, sql } from "drizzle-orm";
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
/** How long a claim holds the row before another worker may take it: longer than the job's own limits (2×10 + 1 minutes). */
export const PROCESS_LEASE_MS = 30 * 60_000;
export const MANIFEST_VERSION = 1;
const TMP_PREFIX = "social-asset-";

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

/** A failure another try cannot fix (nothing to process): the row is failed at once. */
export class PermanentProcessingError extends Error {}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A file's size and SHA-256, read as a stream. */
async function fileFacts(file: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return { bytes: (await stat(file)).size, sha256: hash.digest("hex") };
}

type Rows<T> = { rows?: T[] } | T[];
const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));

/** Claim the next row that may run now; null when there is none. Rows whose tries are spent are failed first. */
export async function claimNext(db: Db = getDb()): Promise<{ id: string; attempt: number } | null> {
  await db.execute(sql`
    update ${sessionRecordings} set process_status = 'failed', process_after = null
     where process_status in ('queued', 'running') and process_after <= now() and process_attempts >= ${PROCESS_TRIES}`);
  const lease = sql.raw(`interval '${PROCESS_LEASE_MS / 1000} seconds'`);
  const result = await db.execute<{ id: string; process_attempts: number }>(sql`
    update ${sessionRecordings}
       set process_status = 'running', process_attempts = process_attempts + 1, process_after = now() + ${lease}
     where id = (
       select id from ${sessionRecordings}
        where process_status in ('queued', 'running') and process_after <= now() and process_attempts < ${PROCESS_TRIES}
        order by process_after
        limit 1
        for update skip locked)
    returning id, process_attempts`);
  const row = rowsOf<{ id: string; process_attempts: number }>(result as unknown as Rows<unknown>)[0];
  return row ? { id: row.id, attempt: Number(row.process_attempts) } : null;
}

/** Does the row still hold this claim? (not deleted, not taken over after the lease ran out) */
async function stillMine(db: Db, id: string, attempt: number): Promise<"mine" | "gone" | "taken"> {
  const [row] = await db
    .select({ status: sessionRecordings.processStatus, attempts: sessionRecordings.processAttempts })
    .from(sessionRecordings)
    .where(eq(sessionRecordings.id, id));
  if (!row) return "gone";
  return row.status === "running" && row.attempts === attempt ? "mine" : "taken";
}

/**
 * Process one recording under claim `attempt`: write the processed files and the manifest, mark it done, remove the raw
 * chunks. If the recording was deleted meanwhile, whatever was written for it is removed.
 */
export async function processRecording(
  id: string,
  attempt: number,
  db: Db = getDb(),
  objects: ObjectStore = objectStore(),
): Promise<void> {
  const [row] = await db
    .select({
      title: sessionRecordings.title,
      name: userDisplay.name,
      chunks: sessionRecordings.mediaChunks,
    })
    .from(sessionRecordings)
    .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
    .where(eq(sessionRecordings.id, id));
  if (!row) return; // deleted meanwhile: nothing to do
  const store = postgresStore(db, objects);
  if (!(await objects.get(assetKey(id, "manifest.json")))) {
    const keys = (await objects.list(`${recordingPrefix(id)}raw/`)).sort();
    if (row.chunks === 0) throw new PermanentProcessingError("no media to process");
    // Every chunk the row counts must be there: a job that lost its lease may find them gone (removed by the one that won).
    if (keys.length !== row.chunks) throw new Error(`expected ${row.chunks} chunks, found ${keys.length}`);
    const messages = (await store.stateMessages(id))
      .map((m) => parseStreamMessage(m))
      .filter((m): m is StreamMessage => m !== null);
    const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
    try {
      const raw = path.join(dir, "raw.webm");
      await writeFile(raw, new Uint8Array());
      for (const key of keys) {
        const chunk = await objects.get(key);
        if (!chunk) throw new Error("a media chunk went missing");
        await appendFile(raw, chunk);
      }
      const mediaFile = path.join(dir, "media.webm");
      // A MediaRecorder file has no duration and no index; a copy remux writes both, without re-encoding.
      await ffmpeg(["-y", "-fflags", "+genpts", "-i", raw, "-map", "0", "-c", "copy", "-cues_to_front", "1", mediaFile]);
      const info = await probe(mediaFile);
      let audio: ManifestFile | null = null;
      if (info.audio) {
        const audioFile = path.join(dir, "audio.m4a");
        await ffmpeg(["-y", "-i", raw, "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", audioFile]);
        audio = { key: "audio.m4a", type: "audio/mp4", ...(await fileFacts(audioFile)) };
      }
      const media: ManifestFile = { key: "media.webm", type: "video/webm", ...(await fileFacts(mediaFile)) };
      const timelineBytes = new TextEncoder().encode(JSON.stringify({ v: 1, duration: info.durationMs, messages }));
      const { chapters, hasVideo } = chaptersOf(messages);
      const manifest: Manifest = {
        v: MANIFEST_VERSION,
        id,
        title: row.title,
        leader: { name: row.name },
        durationMs: info.durationMs,
        hasVideo,
        files: {
          media,
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
      // Only the claim's holder writes: a job that outlived its lease stops here.
      const mine = await stillMine(db, id, attempt);
      if (mine === "gone") return void (await objects.removePrefix(recordingPrefix(id)));
      if (mine === "taken") return;
      if (audio) await objects.putFile(assetKey(id, "audio.m4a"), path.join(dir, "audio.m4a"));
      await objects.putFile(assetKey(id, "media.webm"), mediaFile);
      await objects.put(assetKey(id, "timeline.json"), timelineBytes);
      // The manifest last: its presence says every other file is there.
      await objects.put(assetKey(id, "manifest.json"), new TextEncoder().encode(JSON.stringify(manifest)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const marked = await db
    .update(sessionRecordings)
    .set({
      processStatus: "done",
      processAfter: null,
    })
    .where(
      and(
        eq(sessionRecordings.id, id),
        eq(sessionRecordings.processStatus, "running"),
        eq(sessionRecordings.processAttempts, attempt),
      ),
    )
    .returning({ id: sessionRecordings.id });
  if (marked.length === 0) {
    if ((await stillMine(db, id, attempt)) === "gone") await objects.removePrefix(recordingPrefix(id));
    return;
  }
  await objects.removePrefix(`${recordingPrefix(id)}raw/`);
}

/** After a failed try: back to the queue with a backoff, or failed (after PROCESS_TRIES, or at once when it cannot work). */
async function failed(db: Db, id: string, attempt: number, err: unknown): Promise<void> {
  const last = attempt >= PROCESS_TRIES || err instanceof PermanentProcessingError;
  const wait = PROCESS_BACKOFF_MS[Math.min(attempt - 1, PROCESS_BACKOFF_MS.length - 1)]! * (1 + Math.random() * 0.2);
  log.warn("asset.process_failed", { attempt, final: last, error: err instanceof Error ? err.message.slice(0, 300) : "error" });
  await db
    .update(sessionRecordings)
    .set(
      last
        ? { processStatus: "failed", processAfter: null }
        : { processStatus: "queued", processAfter: sql`now() + ${sql.raw(`interval '${Math.round(wait)} milliseconds'`)}` },
    )
    // Only while it is still this claim's: a late failure never undoes another worker's result.
    .where(
      and(
        eq(sessionRecordings.id, id),
        eq(sessionRecordings.processStatus, "running"),
        eq(sessionRecordings.processAttempts, attempt),
      ),
    );
}

/** Run every row that may run now, one at a time. Returns how many were tried. */
export async function runPending(db: Db = getDb(), objects: ObjectStore = objectStore()): Promise<number> {
  let n = 0;
  for (;;) {
    const job = await claimNext(db);
    if (!job) return n;
    n++;
    try {
      await processRecording(job.id, job.attempt, db, objects);
      log.info("asset.processed", { attempt: job.attempt });
    } catch (err) {
      await failed(db, job.id, job.attempt, err);
    }
  }
}

/** Temporary folders left by a worker that was killed mid-job (older than the lease). */
async function sweepTemp(): Promise<void> {
  const root = tmpdir();
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const dir = path.join(root, name);
    const age = Date.now() - ((await stat(dir).catch(() => null))?.mtimeMs ?? Date.now());
    if (age > PROCESS_LEASE_MS) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
  void sweepTemp();
  kickAssetWorker();
}
