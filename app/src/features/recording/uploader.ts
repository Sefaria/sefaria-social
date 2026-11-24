// The recorder's uploads (spec 041 AC-008; design 4.4): one queue, so media chunks and state batches reach the server in the
// order they were made. A failed upload is tried again with backoff; three failures in a row are fatal — the uploader calls
// onFatal once and refuses everything after, and what was already stored stays (the server finalises the recording).
import type { StreamMessage } from "@sefaria-social/session";

/** Attempts per upload before the recording gives up (AC-008). */
export const UPLOAD_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];

export interface UploaderOptions {
  putMedia(seq: number, blob: Blob): Promise<void>;
  putState(messages: StreamMessage[]): Promise<void>;
  onFatal(error: unknown): void;
  sleep?: (ms: number) => Promise<void>;
}

export interface Uploader {
  putMedia(seq: number, blob: Blob): Promise<void>;
  putState(messages: StreamMessage[]): Promise<void>;
  /** Resolves when everything queued so far has finished (or the uploader failed). */
  idle(): Promise<void>;
  failed(): boolean;
}

export class UploaderFailedError extends Error {
  constructor() {
    super("uploads failed");
    this.name = "UploaderFailedError";
  }
}

export function createUploader(opts: UploaderOptions): Uploader {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let tail: Promise<unknown> = Promise.resolve();
  let fatal = false;

  const run = async (op: () => Promise<void>) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
      if (fatal) throw new UploaderFailedError();
      if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!);
      try {
        await op();
        return;
      } catch (e) {
        lastError = e;
      }
    }
    if (!fatal) {
      fatal = true;
      opts.onFatal(lastError);
    }
    throw new UploaderFailedError();
  };

  const enqueue = (op: () => Promise<void>): Promise<void> => {
    if (fatal) return Promise.reject(new UploaderFailedError());
    const p = tail.then(() => run(op));
    tail = p.catch(() => undefined);
    return p;
  };

  return {
    putMedia: (seq, blob) => enqueue(() => opts.putMedia(seq, blob)),
    putState: (messages) => enqueue(() => opts.putState(messages)),
    idle: () => tail.then(() => undefined),
    failed: () => fatal,
  };
}
