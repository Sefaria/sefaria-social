// Where a session recording's parts live (spec 041; spec 051). Media chunks go to the object store under
// `recordings/<id>/raw/<seq>` (services/object-store.ts); state batches stay in Postgres as jsonb (small, and read as one
// document). The service checks who may write and in what order; the store only keeps and returns bytes and messages.
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { recordingStateChunks, sessionRecordings } from "../db/schema";
import { objectStore, rawChunkKey, recordingPrefix, type ObjectStore } from "./object-store";

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
  /** Remove the recording's row (its state chunks cascade). Its objects go with removeObjects, after the transaction. */
  remove(recordingId: string): Promise<void>;
}

/** Media in the object store, state in Postgres, over a connection or a transaction. */
export function postgresStore(db: Executor, objects: ObjectStore = objectStore()): RecordingStore {
  return {
    async putMedia(recordingId, seq, bytes) {
      await objects.put(rawChunkKey(recordingId, seq), bytes);
    },
    async mediaChunks(recordingId) {
      const keys = (await objects.list(`${recordingPrefix(recordingId)}raw/`)).sort();
      const chunks = await Promise.all(keys.map((k) => objects.get(k)));
      return chunks.filter((c): c is Uint8Array => c !== null);
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

/** Remove every object of these recordings (after the rows are gone). */
export async function removeObjects(recordingIds: readonly string[], objects: ObjectStore = objectStore()): Promise<void> {
  await Promise.all(recordingIds.map((id) => objects.removePrefix(recordingPrefix(id))));
}
