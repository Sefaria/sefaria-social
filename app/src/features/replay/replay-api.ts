// The recording endpoints replay reads (spec 041's API; design section 4.5): a recording's metadata, its state track and its
// media. Plain fetch against host.config.apiOrigin with the viewer's identity token, the way the rooms API sends it; the media
// comes back as one Blob (a <video> cannot send a bearer token), counted as it arrives so the window can show progress.
// Tokens stay in memory: nothing here stores or logs one.
import { z } from "zod";
import type { SurfaceHost } from "@sefaria-social/host-contract";

/** The metadata replay needs; other fields the server sends are ignored. */
const recordingMetaSchema = z.object({
  id: z.string(),
  durationMs: z.number().finite().nonnegative().nullable().optional(),
  mediaBytes: z.number().int().nonnegative().nullable().optional(),
  mime: z.string().nullable().optional(),
});
export type RecordingMeta = z.infer<typeof recordingMetaSchema>;

/** Any answer other than 200; `status` 0 for a network failure. */
export class ReplayApiError extends Error {
  constructor(readonly status: number) {
    super(`social API answered ${status}`);
    this.name = "ReplayApiError";
  }
}

export interface ReplayApi {
  getRecording(recordingId: string): Promise<RecordingMeta>;
  /** The `Recording` v1 document, unparsed (the caller parses it with the session schema). */
  getState(recordingId: string): Promise<unknown>;
  /** The media as one Blob. `onProgress` hears bytes received and the total when known. */
  getMedia(
    recordingId: string,
    opts?: { expectedBytes?: number; onProgress?: (loaded: number, total: number | null) => void },
  ): Promise<Blob>;
}

export function createReplayApi(host: SurfaceHost, fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)): ReplayApi {
  const base = host.config.apiOrigin.replace(/\/+$/, "");
  const path = (recordingId: string, rest = "") => `${base}/api/v1/recordings/${encodeURIComponent(recordingId)}${rest}`;

  const request = async (url: string): Promise<Response> => {
    const headers = new Headers({ "x-correlation-id": crypto.randomUUID() });
    const token = host.viewer.get() ? await host.viewer.identityToken().catch(() => null) : null;
    if (token) headers.set("authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers });
    } catch {
      throw new ReplayApiError(0);
    }
    if (!response.ok) throw new ReplayApiError(response.status);
    return response;
  };

  return {
    async getRecording(recordingId) {
      const response = await request(path(recordingId));
      const parsed = recordingMetaSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new ReplayApiError(response.status);
      return parsed.data;
    },
    async getState(recordingId) {
      const response = await request(path(recordingId, "/state"));
      return response.json();
    },
    async getMedia(recordingId, opts = {}) {
      const response = await request(path(recordingId, "/media"));
      const type = response.headers.get("content-type") ?? "";
      const length = Number(response.headers.get("content-length"));
      const total = Number.isFinite(length) && length > 0 ? length : (opts.expectedBytes ?? null);
      if (!response.body) {
        const blob = await response.blob();
        opts.onProgress?.(blob.size, total ?? blob.size);
        return blob;
      }
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let loaded = 0;
      opts.onProgress?.(0, total);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.byteLength;
        opts.onProgress?.(loaded, total);
      }
      return new Blob(parts as BlobPart[], { type });
    },
  };
}
