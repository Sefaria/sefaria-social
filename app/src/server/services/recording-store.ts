// Where a session recording's chunks live (spec 041; design docs/design/session-recording-and-broadcast.md §4.5). Postgres
// bytea and jsonb for now; object storage is a later seam behind the same interface (design §3.2). The service checks who may
// write and in what order; the store only keeps and returns bytes and messages, in order.
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { recordingMediaChunks, recordingStateChunks, sessionRecordings } from "../db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface RecordingStore {
  /** Keep media chunk `seq` (the service has checked that it is the next one). */
  putMedia(recordingId: string, seq: number, bytes: Uint8Array): Promise<void>;
  /** Every media chunk, in seq order. */
  mediaChunks(recordingId: string): Promise<Uint8Array[]>;
  /** Keep a batch of state messages whose seqs run from `firstSeq` to `lastSeq`. */
  putState(recordingId: string, firstSeq: number, lastSeq: number, messages: readonly unknown[]): Promise<void>;
  /** Every state message, in seq order. */
  stateMessages(recordingId: string): Promise<unknown[]>;
  /** Remove the recording and everything stored for it. */
  remove(recordingId: string): Promise<void>;
}

/** The Postgres store, over a connection or a transaction (chunk rows cascade with the recording row). */
export function postgresStore(db: Executor): RecordingStore {
  return {
    async putMedia(recordingId, seq, bytes) {
      await db.insert(recordingMediaChunks).values({ recordingId, seq, bytes: Buffer.from(bytes) });
    },
    async mediaChunks(recordingId) {
      const rows = await db
        .select({ bytes: recordingMediaChunks.bytes })
        .from(recordingMediaChunks)
        .where(eq(recordingMediaChunks.recordingId, recordingId))
        .orderBy(asc(recordingMediaChunks.seq));
      return rows.map((r) => r.bytes);
    },
    async putState(recordingId, firstSeq, lastSeq, messages) {
      await db.insert(recordingStateChunks).values({ recordingId, firstSeq, lastSeq, messages: [...messages] });
    },
    async stateMessages(recordingId) {
      const rows = await db
        .select({ messages: recordingStateChunks.messages })
        .from(recordingStateChunks)
        .where(eq(recordingStateChunks.recordingId, recordingId))
        .orderBy(asc(recordingStateChunks.firstSeq));
      return rows.flatMap((r) => (Array.isArray(r.messages) ? (r.messages as unknown[]) : []));
    },
    async remove(recordingId) {
      await db.delete(sessionRecordings).where(eq(sessionRecordings.id, recordingId));
    },
  };
}
