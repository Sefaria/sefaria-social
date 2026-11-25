// Session recordings (spec 041; design docs/design/session-recording-and-broadcast.md §4). The room's owner records in their
// browser; the server keeps what is uploaded, in order, and serves it back to the room's members. Every read or write by id
// first finds the caller's membership of the recording's room: not a member (or no such recording) is recording.not_found, so
// ids cannot be probed. Only the recorder uploads; the recorder or the room's owner deletes. A recording with no upload for
// RECORDING_STALE_MS is finalised when it is next read (ready with what arrived, or deleted when nothing did).
import { parseStreamMessage, type StreamMessage } from "@sefaria-social/session";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { createHash } from "node:crypto";
import { recordingStateChunks, roomMembers, sessionRecordings, userDisplay } from "../db/schema";
import { ApiError } from "../http/errors";
import { setRoomRecording } from "./livekit";
import { postgresStore, removeObjects, type Executor, type RecordingStore } from "./recording-store";
import { assetKey, objectStore } from "./object-store";
import { ensureAssetWorker, kickAssetWorker } from "../jobs/process-asset";
import { membership } from "./rooms";
import { upsertDisplay } from "./users";

/** One media chunk (the recorder's 5-second timeslice) at most. */
export const MAX_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
/** All media of one recording at most (about two hours at the recorder's bitrate). */
export const MAX_MEDIA_BYTES = 700 * 1024 * 1024;
/** One state batch's JSON body at most. */
export const MAX_STATE_BATCH_BYTES = 256 * 1024;
/** No upload for this long and a running recording is finalised on its next read. */
export const RECORDING_STALE_MS = 2 * 60 * 1000;
/** The `client` the assembled state track names. */
export const RECORDING_CLIENT = "sefaria-social";

const STALE_INTERVAL = sql.raw(`interval '${RECORDING_STALE_MS / 1000} seconds'`);

export type RecordingStatus = "recording" | "ready" | "failed";

export interface RecordingDto {
  id: string;
  roomId: string;
  title: string | null;
  status: RecordingStatus;
  mime: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  mediaBytes: number;
  stateMessages: number;
  owner: { userId: number; name: string | null };
  /** The caller may delete it: they recorded it or own the room. */
  canDelete: boolean;
}

/** The reader's `Recording` v1 document (packages/session), assembled from the stored state batches. */
export interface RecordingStateDto {
  v: 1;
  startedAt: string;
  duration: number;
  client: string;
  messages: StreamMessage[];
}

export const recordingsEnabled = (): boolean => getConfig().RECORDINGS_ENABLED !== "false";

const columns = {
  id: sessionRecordings.id,
  roomId: sessionRecordings.roomId,
  ownerUserId: sessionRecordings.ownerUserId,
  title: sessionRecordings.title,
  status: sessionRecordings.status,
  mime: sessionRecordings.mime,
  startedAt: sessionRecordings.startedAt,
  finishedAt: sessionRecordings.finishedAt,
  durationMs: sessionRecordings.durationMs,
  mediaBytes: sessionRecordings.mediaBytes,
  stateMessages: sessionRecordings.stateMessages,
  role: roomMembers.role,
  ownerName: userDisplay.name,
};

type Row = {
  id: string;
  roomId: string;
  ownerUserId: number;
  title: string | null;
  status: string;
  mime: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  mediaBytes: number;
  stateMessages: number;
  role: string;
  ownerName: string | null;
};

const statusOf = (s: string): RecordingStatus => (s === "ready" || s === "failed" ? s : "recording");

const toDto = (r: Row, identity: Identity): RecordingDto => ({
  id: r.id,
  roomId: r.roomId,
  title: r.title,
  status: statusOf(r.status),
  mime: r.mime,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  durationMs: r.durationMs,
  mediaBytes: r.mediaBytes,
  stateMessages: r.stateMessages,
  owner: { userId: r.ownerUserId, name: r.ownerName },
  canDelete: r.ownerUserId === identity.userId || r.role === "owner",
});

/** A recording with the caller's role in its room; 404 when either is missing. `lock` takes the row for update. */
async function visible(db: Executor, identity: Identity, recordingId: string, lock = false): Promise<Row> {
  const q = db
    .select(columns)
    .from(sessionRecordings)
    .innerJoin(roomMembers, and(eq(roomMembers.roomId, sessionRecordings.roomId), eq(roomMembers.userId, identity.userId)))
    .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
    .where(eq(sessionRecordings.id, recordingId))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: sessionRecordings }) : await q;
  if (!row) throw new ApiError(404, "recording.not_found");
  return row;
}

/** The recorder's own running recording, locked for an upload: 403 for anyone else, 409 once it is not running. */
async function forUpload(tx: Executor, identity: Identity, recordingId: string): Promise<Row> {
  const row = await visible(tx, identity, recordingId, true);
  if (row.ownerUserId !== identity.userId) throw new ApiError(403, "recording.forbidden");
  if (row.status !== "recording") throw new ApiError(409, "recording.not_recording");
  return row;
}

/**
 * Finalise running recordings with no upload for RECORDING_STALE_MS (in this room, or this one recording): ready, with the
 * last state message's `t` as the duration when none was given; a recording with nothing stored is deleted. Returns the rooms
 * whose recording stopped, so the call's metadata can be cleared.
 */
export async function finaliseStale(scope: { roomId: string } | { recordingId: string }, db: Db = getDb()): Promise<string[]> {
  const where = and(
    "roomId" in scope ? eq(sessionRecordings.roomId, scope.roomId) : eq(sessionRecordings.id, scope.recordingId),
    eq(sessionRecordings.status, "recording"),
    lt(sessionRecordings.lastUploadAt, sql`now() - ${STALE_INTERVAL}`),
  );
  const stopped = await db.transaction(async (tx) => {
    const empty = await tx
      .delete(sessionRecordings)
      .where(and(where, eq(sessionRecordings.mediaBytes, 0), eq(sessionRecordings.stateMessages, 0)))
      .returning({ roomId: sessionRecordings.roomId });
    const lastT = sql`(select round((c.messages -> -1 ->> 't')::numeric)::int from ${recordingStateChunks} c
      where c.recording_id = ${sessionRecordings.id} order by c.first_seq desc limit 1)`;
    const ready = await tx
      .update(sessionRecordings)
      .set({
        status: "ready",
        finishedAt: sql`now()`,
        durationMs: sql`coalesce(${sessionRecordings.durationMs}, ${lastT}, 0)`,
        processStatus: "queued",
        processAfter: sql`now()`,
      })
      .where(where)
      .returning({ roomId: sessionRecordings.roomId });
    return [...empty, ...ready].map((r) => r.roomId);
  });
  await Promise.all([...new Set(stopped)].map((roomId) => setRoomRecording(roomId, false)));
  return stopped;
}

/** Start recording a room (AC-001): its owner only, recordings on, none running. */
export async function startRecording(
  identity: Identity,
  roomId: string,
  input: { mime?: string | undefined },
  db: Db = getDb(),
): Promise<RecordingDto> {
  const m = await membership(db, identity, roomId);
  if (m.role !== "owner") throw new ApiError(403, "room.forbidden");
  if (!recordingsEnabled()) throw new ApiError(503, "recording.unavailable");
  await finaliseStale({ roomId }, db); // an abandoned recording does not hold the room
  const id = await db
    .transaction(async (tx) => {
      await upsertDisplay(tx, identity);
      const [running] = await tx
        .select({ id: sessionRecordings.id })
        .from(sessionRecordings)
        .where(and(eq(sessionRecordings.roomId, roomId), eq(sessionRecordings.status, "recording")))
        .limit(1);
      if (running) throw new ApiError(409, "recording.already_running");
      const [row] = await tx
        .insert(sessionRecordings)
        .values({ roomId, ownerUserId: identity.userId, title: m.title, mime: input.mime ?? null })
        .returning({ id: sessionRecordings.id });
      return row!.id;
    })
    .catch((e: unknown) => {
      // two starts racing: the partial unique index lets one through
      if ((e as { code?: unknown; cause?: { code?: unknown } }).code === "23505")
        throw new ApiError(409, "recording.already_running");
      if ((e as { cause?: { code?: unknown } }).cause?.code === "23505") throw new ApiError(409, "recording.already_running");
      throw e;
    });
  await setRoomRecording(roomId, true);
  return toDto(await visible(db, identity, id), identity);
}

/** Keep media chunk `seq` (AC-002): the recorder, while running, the next seq, within the caps. */
export async function putMedia(
  identity: Identity,
  recordingId: string,
  seq: number,
  bytes: Uint8Array,
  db: Db = getDb(),
  store: (tx: Executor) => RecordingStore = postgresStore,
): Promise<void> {
  if (bytes.byteLength === 0) throw new ApiError(400, "request.invalid");
  if (bytes.byteLength > MAX_MEDIA_CHUNK_BYTES) throw new ApiError(413, "request.too_large");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.transaction(async (tx) => {
    const row = await forUpload(tx, identity, recordingId);
    // The row is locked: the count and the last chunk's hash cannot move under us (spec 051 AC-005).
    const [counts] = await tx
      .select({ chunks: sessionRecordings.mediaChunks, last: sessionRecordings.lastChunkSha256 })
      .from(sessionRecordings)
      .where(eq(sessionRecordings.id, recordingId));
    const next = counts?.chunks ?? 0;
    if (seq === next - 1 && counts?.last === sha256) return; // a retry whose first try landed
    if (seq !== next) throw new ApiError(409, "recording.out_of_order");
    if (row.mediaBytes + bytes.byteLength > MAX_MEDIA_BYTES) throw new ApiError(413, "recording.too_large");
    // Written before the row: a failed write leaves the count, so the recorder retries the same seq (the same key).
    await store(tx).putMedia(recordingId, seq, bytes);
    await tx
      .update(sessionRecordings)
      .set({
        mediaBytes: sql`${sessionRecordings.mediaBytes} + ${bytes.byteLength}`,
        mediaChunks: sql`${sessionRecordings.mediaChunks} + 1`,
        lastChunkSha256: sha256,
        lastUploadAt: sql`now()`,
      })
      .where(eq(sessionRecordings.id, recordingId));
  });
}

/**
 * Keep a batch of state messages (AC-002): each must parse with the session's stream schema (400 otherwise), their seqs must
 * run on by one, and the first must continue the stored ones (409 otherwise). The whole batch is kept or none of it.
 */
export async function putState(
  identity: Identity,
  recordingId: string,
  messages: readonly unknown[],
  db: Db = getDb(),
  store: (tx: Executor) => RecordingStore = postgresStore,
): Promise<{ stored: number }> {
  const parsed = messages.map((m) => parseStreamMessage(m));
  const valid = parsed.filter((m): m is StreamMessage => m !== null);
  if (valid.length !== messages.length || valid.length === 0) throw new ApiError(400, "request.invalid");
  if (valid.some((m, i) => i > 0 && m.seq !== valid[i - 1]!.seq + 1)) throw new ApiError(409, "recording.out_of_order");
  await db.transaction(async (tx) => {
    await forUpload(tx, identity, recordingId);
    const [last] = await tx
      .select({ seq: sql<number | null>`max(${recordingStateChunks.lastSeq})` })
      .from(recordingStateChunks)
      .where(eq(recordingStateChunks.recordingId, recordingId));
    const first = valid[0]!.seq;
    if (last?.seq !== null && last?.seq !== undefined && first !== Number(last.seq) + 1)
      throw new ApiError(409, "recording.out_of_order");
    await store(tx).putState(recordingId, first, valid.at(-1)!.seq, valid);
    await tx
      .update(sessionRecordings)
      .set({ stateMessages: sql`${sessionRecordings.stateMessages} + ${valid.length}`, lastUploadAt: sql`now()` })
      .where(eq(sessionRecordings.id, recordingId));
  });
  return { stored: valid.length };
}

/** The recorder finishes (AC-003): ready, with the duration it measured. */
export async function finishRecording(
  identity: Identity,
  recordingId: string,
  durationMs: number,
  db: Db = getDb(),
): Promise<RecordingDto> {
  const roomId = await db.transaction(async (tx) => {
    const row = await forUpload(tx, identity, recordingId);
    await tx
      .update(sessionRecordings)
      .set({
        status: "ready",
        durationMs: Math.round(durationMs),
        finishedAt: sql`now()`,
        // Spec 052: queued for processing; it plays from the raw chunks until that is done.
        processStatus: "queued",
        processAfter: sql`now()`,
      })
      .where(eq(sessionRecordings.id, recordingId));
    return row.roomId;
  });
  await setRoomRecording(roomId, false);
  ensureAssetWorker();
  kickAssetWorker();
  return toDto(await visible(db, identity, recordingId), identity);
}

/** A room's recordings, newest first (AC-004). Members only. */
export async function listRecordings(identity: Identity, roomId: string, db: Db = getDb()): Promise<RecordingDto[]> {
  await membership(db, identity, roomId);
  await finaliseStale({ roomId }, db);
  const rows = await db
    .select(columns)
    .from(sessionRecordings)
    .innerJoin(roomMembers, and(eq(roomMembers.roomId, sessionRecordings.roomId), eq(roomMembers.userId, identity.userId)))
    .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
    .where(eq(sessionRecordings.roomId, roomId))
    .orderBy(desc(sessionRecordings.startedAt), desc(sessionRecordings.createdAt), desc(sessionRecordings.id));
  return rows.map((r) => toDto(r, identity));
}

/** One recording's metadata (AC-004). Members of its room only. */
export async function getRecording(identity: Identity, recordingId: string, db: Db = getDb()): Promise<RecordingDto> {
  await visible(db, identity, recordingId); // a non-member learns nothing, not even that it is stale
  await finaliseStale({ recordingId }, db);
  return toDto(await visible(db, identity, recordingId), identity);
}

/** The state track as the reader's `Recording` v1 (AC-004). */
export async function getRecordingState(
  identity: Identity,
  recordingId: string,
  db: Db = getDb(),
  store: RecordingStore = postgresStore(db),
): Promise<RecordingStateDto> {
  const row = await getRecording(identity, recordingId, db);
  const messages = (await store.stateMessages(recordingId))
    .map((m) => parseStreamMessage(m))
    .filter((m): m is StreamMessage => m !== null);
  return {
    v: 1,
    startedAt: row.startedAt,
    duration: row.durationMs ?? Math.round(messages.at(-1)?.t ?? 0),
    client: RECORDING_CLIENT,
    messages,
  };
}

/** The media (AC-004; spec 052): the processed file, by byte range, once it exists; until then every chunk in order. */
export async function getRecordingMedia(
  identity: Identity,
  recordingId: string,
  range: string | null = null,
  db: Db = getDb(),
  store: RecordingStore = postgresStore(db),
): Promise<MediaAnswer> {
  const row = await getRecording(identity, recordingId, db);
  return mediaOf(recordingId, row.mime, range, store);
}

/** Delete a recording and its chunks (AC-005): the recorder or the room's owner. */
export async function deleteRecording(
  identity: Identity,
  recordingId: string,
  db: Db = getDb(),
  store: (tx: Executor) => RecordingStore = postgresStore,
): Promise<void> {
  const row = await db.transaction(async (tx) => {
    const r = await visible(tx, identity, recordingId, true);
    if (r.ownerUserId !== identity.userId && r.role !== "owner") throw new ApiError(403, "recording.forbidden");
    await store(tx).remove(recordingId);
    return r;
  });
  await removeObjects([recordingId]); // spec 051 AC-005: its media goes with it
  if (row.status === "recording") await setRoomRecording(row.roomId, false);
}

/** Which of these rooms are being recorded now (AC-006): a running recording that is not stale. */
export async function recordingOf(roomIds: readonly string[], db: Db = getDb()): Promise<Set<string>> {
  if (roomIds.length === 0) return new Set();
  const rows = await db
    .select({ roomId: sessionRecordings.roomId })
    .from(sessionRecordings)
    .where(
      and(
        inArray(sessionRecordings.roomId, [...roomIds]),
        eq(sessionRecordings.status, "recording"),
        sql`${sessionRecordings.lastUploadAt} >= now() - ${STALE_INTERVAL}`,
      ),
    );
  return new Set(rows.map((r) => r.roomId));
}

/**
 * Remove the objects of recordings whose rows are gone (spec 051 AC-005): a deleted room or user takes its recordings' rows with
 * it by cascade, and this takes their media. Run after such a deletion commits. Returns how many recordings' objects went.
 */
export async function sweepOrphanObjects(db: Db = getDb(), objects = objectStore()): Promise<number> {
  const keys = await objects.list("recordings/");
  const ids = [...new Set(keys.map((k) => k.split("/")[1]).filter((id): id is string => !!id && UUID.test(id)))];
  if (ids.length === 0) return 0;
  const kept = await db.select({ id: sessionRecordings.id }).from(sessionRecordings).where(inArray(sessionRecordings.id, ids));
  const live = new Set(kept.map((r) => r.id));
  const gone = ids.filter((id) => !live.has(id));
  await removeObjects(gone, objects);
  return gone.length;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Public reads (spec 051 AC-004; docs/plans/shiur.md D2) ─────────────────────────────────────────────────────────────

/** What anyone with a ready recording's link may know: no room, no user ids, nothing a member alone sees. */
export interface AssetDto {
  id: string;
  title: string | null;
  status: "ready";
  mime: string | null;
  startedAt: string;
  durationMs: number | null;
  leader: { name: string | null };
}

/** A ready recording by id, for anyone; 404 for one that is still recording, failed, or unknown. */
async function readyAsset(db: Db, assetId: string) {
  await finaliseStale({ recordingId: assetId }, db);
  const [row] = await db
    .select({
      id: sessionRecordings.id,
      title: sessionRecordings.title,
      status: sessionRecordings.status,
      mime: sessionRecordings.mime,
      startedAt: sessionRecordings.startedAt,
      durationMs: sessionRecordings.durationMs,
      name: userDisplay.name,
    })
    .from(sessionRecordings)
    .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
    .where(and(eq(sessionRecordings.id, assetId), eq(sessionRecordings.status, "ready")))
    .limit(1);
  if (!row) throw new ApiError(404, "recording.not_found");
  return row;
}

export async function getAsset(assetId: string, db: Db = getDb()): Promise<AssetDto> {
  const r = await readyAsset(db, assetId);
  return {
    id: r.id,
    title: r.title,
    status: "ready",
    mime: r.mime,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    leader: { name: r.name },
  };
}

export async function getAssetState(
  assetId: string,
  db: Db = getDb(),
  store: RecordingStore = postgresStore(db),
): Promise<RecordingStateDto> {
  const r = await readyAsset(db, assetId);
  const messages = (await store.stateMessages(assetId))
    .map((m) => parseStreamMessage(m))
    .filter((m): m is StreamMessage => m !== null);
  return {
    v: 1,
    startedAt: r.startedAt.toISOString(),
    duration: r.durationMs ?? Math.round(messages.at(-1)?.t ?? 0),
    client: RECORDING_CLIENT,
    messages,
  };
}

export async function getAssetMedia(
  assetId: string,
  range: string | null = null,
  db: Db = getDb(),
  store: RecordingStore = postgresStore(db),
): Promise<MediaAnswer> {
  const r = await readyAsset(db, assetId);
  return mediaOf(assetId, r.mime, range, store);
}

/** Spec 052: a ready recording's manifest once processing is done; 404 recording.not_processed until then. */
export async function getAssetManifest(assetId: string, db: Db = getDb(), objects = objectStore()): Promise<unknown> {
  await readyAsset(db, assetId);
  const bytes = await objects.get(assetKey(assetId, "manifest.json"));
  if (!bytes) throw new ApiError(404, "recording.not_processed");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

// ── Media by byte range (spec 052 AC-004) ──────────────────────────────────────────────────────────────────────────────

/** The most one range answer carries; a player asks again for the rest. */
export const MAX_RANGE_BYTES = 8 * 1024 * 1024;

export type MediaAnswer =
  | { status: 200; bytes: Uint8Array; contentType: string; headers: Record<string, string> }
  | { status: 206; bytes: Uint8Array; contentType: string; headers: Record<string, string> };

/** One `bytes=` range of a file of `size` bytes: [start, end] inclusive, "unsatisfiable", or null (none, or not one range). */
export function parseRange(header: string | null, size: number): [number, number] | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "unsatisfiable";
  return [start, end];
}

async function mediaOf(id: string, mime: string | null, range: string | null, store: RecordingStore): Promise<MediaAnswer> {
  const objects = objectStore();
  const key = assetKey(id, "media.webm");
  const size = await objects.size(key);
  if (size === null) {
    // Not processed yet: the raw chunks, whole (a MediaRecorder file cannot be seeked anyway).
    const chunks = await store.mediaChunks(id);
    return { status: 200, bytes: Buffer.concat(chunks), contentType: mime ?? "application/octet-stream", headers: {} };
  }
  const r = parseRange(range, size);
  if (r === "unsatisfiable") throw new ApiError(416, "request.range_not_satisfiable", { "content-range": `bytes */${size}` });
  if (r === null) {
    const bytes = (await objects.getRange(key, 0, size - 1)) ?? new Uint8Array();
    return { status: 200, bytes, contentType: "video/webm", headers: { "accept-ranges": "bytes" } };
  }
  const [start, wanted] = r;
  const end = Math.min(wanted, start + MAX_RANGE_BYTES - 1);
  const bytes = (await objects.getRange(key, start, end)) ?? new Uint8Array();
  return {
    status: 206,
    bytes,
    contentType: "video/webm",
    headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${start + bytes.byteLength - 1}/${size}` },
  };
}
