// The recording endpoints replay reads (spec 041's API; design section 4.5): a room's recordings, a recording's metadata, its
// state track and its media, and deleting one. Plain fetch against host.config.apiOrigin with the viewer's identity token, the way the rooms API sends it; the media
// comes back as one Blob (a <video> cannot send a bearer token), counted as it arrives so the window can show progress.
// Tokens stay in memory: nothing here stores or logs one.
import { z } from "zod";
import type { SurfaceHost } from "@sefaria-social/host-contract";

/**
 * The metadata replay and the recording pages need (the server's `Recording`); other fields are ignored, and only `id` is
 * required, so a field the server adds or leaves out never breaks playback.
 */
const recordingMetaSchema = z.object({
  id: z.string(),
  roomId: z.string().optional(),
  title: z.string().nullable().optional(),
  status: z.string().optional(),
  startedAt: z.string().optional(),
  durationMs: z.number().finite().nonnegative().nullable().optional(),
  mediaBytes: z.number().int().nonnegative().nullable().optional(),
  mime: z.string().nullable().optional(),
  owner: z.object({ userId: z.number(), name: z.string().nullable().optional() }).optional(),
  canDelete: z.boolean().optional(),
  /** The public asset's leader (spec 051), when it was read without membership. */
  leader: z.object({ name: z.string().nullable().optional() }).optional(),
});

/** A processed recording's manifest (spec 052), as far as the player needs it; other fields are ignored. */
const manifestSchema = z.object({
  durationMs: z.number().finite().nonnegative().optional(),
  hasVideo: z.boolean().optional(),
  chapters: z
    .array(z.object({ t: z.number().finite().nonnegative(), ref: z.string(), heRef: z.string().nullable().optional() }))
    .optional(),
});
export type AssetManifest = z.infer<typeof manifestSchema>;
export type RecordingMeta = z.infer<typeof recordingMetaSchema>;
const recordingListSchema = z.object({ recordings: z.array(recordingMetaSchema) });

/** Any answer other than 200; `status` 0 for a network failure. */
export class ReplayApiError extends Error {
  constructor(readonly status: number) {
    super(`social API answered ${status}`);
    this.name = "ReplayApiError";
  }
}

export interface ReplayApi {
  /** The room's recordings, as the server lists them. */
  listRecordings(roomId: string): Promise<RecordingMeta[]>;
  /** Deletes a recording (its recorder or the room's owner); throws ReplayApiError(403) for anyone else. */
  deleteRecording(recordingId: string): Promise<void>;
  getRecording(recordingId: string): Promise<RecordingMeta>;
  /** The `Recording` v1 document, unparsed (the caller parses it with the session schema). */
  getState(recordingId: string): Promise<unknown>;
  /** Spec 053: the processed recording's manifest (chapters, video or not), or null before it is processed. Optional for fakes. */
  getManifest?(recordingId: string): Promise<AssetManifest | null>;
  /** The media as one Blob. `onProgress` hears bytes received and the total when known. */
  getMedia(
    recordingId: string,
    opts?: { expectedBytes?: number; onProgress?: (loaded: number, total: number | null) => void },
  ): Promise<Blob>;
}

export function createReplayApi(host: SurfaceHost, fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)): ReplayApi {
  const base = host.config.apiOrigin.replace(/\/+$/, "");
  const path = (recordingId: string, rest = "") => `${base}/api/v1/recordings/${encodeURIComponent(recordingId)}${rest}`;
  /** Spec 051: a ready recording's public reads, for anyone with its link (signed out included). */
  const asset = (recordingId: string, rest = "") => `${base}/api/v1/assets/${encodeURIComponent(recordingId)}${rest}`;

  const request = async (url: string, method = "GET"): Promise<Response> => {
    const headers = new Headers({ "x-correlation-id": crypto.randomUUID() });
    const token = host.viewer.get() ? await host.viewer.identityToken().catch(() => null) : null;
    if (token) headers.set("authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetchImpl(url, method === "GET" ? { headers } : { method, headers });
    } catch {
      throw new ReplayApiError(0);
    }
    if (!response.ok) throw new ReplayApiError(response.status);
    return response;
  };

  /**
   * Spec 053: the member read when signed in; the public one (a ready recording, for anyone with its link, spec 051) when signed
   * out or when the member read is refused (the viewer is not in the recording's room).
   */
  const memberOrPublic = async (member: string, open: string): Promise<Response> => {
    if (!host.viewer.get()) return request(open);
    try {
      return await request(member);
    } catch (e) {
      if (e instanceof ReplayApiError && [401, 403, 404].includes(e.status)) return request(open);
      throw e;
    }
  };

  return {
    async listRecordings(roomId) {
      const response = await request(`${base}/api/v1/rooms/${encodeURIComponent(roomId)}/recordings`);
      const parsed = recordingListSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new ReplayApiError(response.status);
      return parsed.data.recordings;
    },
    async deleteRecording(recordingId) {
      await request(path(recordingId), "DELETE");
    },
    async getRecording(recordingId) {
      // A member sees the room's view (who may delete it); anyone else, or a member of another room, the public asset.
      const response = await memberOrPublic(path(recordingId), asset(recordingId));
      const parsed = recordingMetaSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new ReplayApiError(response.status);
      return parsed.data;
    },
    async getState(recordingId) {
      const response = await memberOrPublic(path(recordingId, "/state"), asset(recordingId, "/state"));
      return response.json();
    },
    async getManifest(recordingId) {
      try {
        const response = await request(asset(recordingId, "/manifest"));
        const parsed = manifestSchema.safeParse(await response.json().catch(() => null));
        return parsed.success ? parsed.data : null;
      } catch (e) {
        if (e instanceof ReplayApiError && e.status === 404) return null;
        throw e;
      }
    },
    async getMedia(recordingId, opts = {}) {
      const response = await memberOrPublic(path(recordingId, "/media"), asset(recordingId, "/media"));
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
