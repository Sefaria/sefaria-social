// The recording calls the owner's browser makes (spec 041; design docs/design/session-recording-and-broadcast.md 4.5). Plain
// fetch against host.config.apiOrigin with the viewer's identity token as a bearer, like the generated client does for the
// rooms API; the token comes from the host each time and is never stored, logged or put in a URL.
import { z } from "zod";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import type { StreamMessage } from "@sefaria-social/session";

export type StartResult =
  { kind: "ok"; id: string } | { kind: "already-recording" } | { kind: "forbidden" } | { kind: "unavailable" };

export interface RecordingApi {
  start(roomId: string): Promise<StartResult>;
  /** Throws on anything but success, so the uploader retries. */
  putMedia(recordingId: string, seq: number, blob: Blob): Promise<void>;
  putState(recordingId: string, messages: StreamMessage[]): Promise<void>;
  finish(recordingId: string, durationMs: number): Promise<void>;
}

export class RecordingApiError extends Error {
  constructor(readonly status: number) {
    super(`social API answered ${status}`);
    this.name = "RecordingApiError";
  }
}

const Started = z.object({ id: z.string().min(1) });

export interface RecordingApiOptions {
  apiOrigin: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createRecordingApi({ apiOrigin, getToken, fetch: f = (...a) => fetch(...a) }: RecordingApiOptions): RecordingApi {
  const base = apiOrigin.replace(/\/+$/, "");
  const call = async (method: string, path: string, body?: { json: unknown } | { bytes: Blob }) => {
    const headers = new Headers({ "x-correlation-id": crypto.randomUUID() });
    const token = await getToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    let payload: BodyInit | undefined;
    if (body && "json" in body) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body.json);
    } else if (body) {
      headers.set("content-type", "application/octet-stream");
      payload = body.bytes;
    }
    return f(`${base}${path}`, { method, headers, body: payload });
  };
  const ok = (r: Response) => {
    if (!r.ok) throw new RecordingApiError(r.status);
  };
  const id = encodeURIComponent;
  return {
    async start(roomId) {
      const r = await call("POST", `/api/v1/rooms/${id(roomId)}/recordings`);
      if (r.status === 201 || r.status === 200) {
        const parsed = Started.safeParse(await r.json().catch(() => null));
        if (parsed.success) return { kind: "ok", id: parsed.data.id };
        throw new RecordingApiError(r.status);
      }
      if (r.status === 409) return { kind: "already-recording" };
      if (r.status === 403 || r.status === 404) return { kind: "forbidden" };
      if (r.status === 503) return { kind: "unavailable" };
      throw new RecordingApiError(r.status);
    },
    async putMedia(recordingId, seq, blob) {
      ok(await call("PUT", `/api/v1/recordings/${id(recordingId)}/media/${seq}`, { bytes: blob }));
    },
    async putState(recordingId, messages) {
      ok(await call("POST", `/api/v1/recordings/${id(recordingId)}/state`, { json: { messages } }));
    },
    async finish(recordingId, durationMs) {
      ok(await call("POST", `/api/v1/recordings/${id(recordingId)}/finish`, { json: { durationMs: Math.round(durationMs) } }));
    },
  };
}

const built = new WeakMap<SurfaceHost, RecordingApi>();

/** The recording API built from this host (one per host). */
export function recordingApiFor(host: SurfaceHost): RecordingApi {
  let api = built.get(host);
  if (!api) {
    api = createRecordingApi({
      apiOrigin: host.config.apiOrigin,
      getToken: async () => (host.viewer.get() ? host.viewer.identityToken().catch(() => null) : null),
    });
    built.set(host, api);
  }
  return api;
}
