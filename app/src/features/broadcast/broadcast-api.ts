// The broadcast calls the surface makes (spec 043; design docs/design/session-recording-and-broadcast.md 6): start and end
// (the room's owner), read one (anyone signed in with its id), a relay ticket for its room, and a token for its call. Over the
// generated client like the rooms API, with each answer parsed before use. Tickets and tokens stay in memory: nothing here
// stores, logs or puts one in a URL.
import { createContext, useContext } from "react";
import { z } from "zod";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { createApiClient } from "@sefaria-social/api-client";
import type { CallTokenResult } from "~/features/api/rooms-api";
import { useHost } from "~/features/host/host-context";
import { documentHostFor } from "~/features/host/document-host";

const broadcastSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  title: z.string(),
  hostName: z.string().nullable(),
  status: z.enum(["live", "ended"]),
  startedAt: z.string(),
  link: z.string().regex(/^\/social\/b\/[A-Za-z0-9_-]{8,128}$/),
});
export type Broadcast = z.infer<typeof broadcastSchema>;

const ticketSchema = z.object({
  ticket: z.string().min(1),
  role: z.enum(["host", "viewer"]),
  relayRoom: z.string().regex(/^b_[A-Za-z0-9_-]{8,128}$/),
  expiresAt: z.string(),
});
export type BroadcastTicket = z.infer<typeof ticketSchema>;

const callTokenSchema = z.object({ url: z.string().min(1), token: z.string().min(1), expiresAt: z.string() });

export type StartBroadcastResult = { kind: "ok"; broadcast: Broadcast } | { kind: "already-live" } | { kind: "forbidden" };
export type GetBroadcastResult = { kind: "ok"; broadcast: Broadcast } | { kind: "not-found" };
/** `ended` covers an ended broadcast and one that does not exist: the server answers both with 404. */
export type TicketResult = { kind: "ok"; ticket: BroadcastTicket } | { kind: "ended" };

export interface BroadcastApi {
  start(roomId: string): Promise<StartBroadcastResult>;
  end(broadcastId: string): Promise<void>;
  get(broadcastId: string): Promise<GetBroadcastResult>;
  ticket(broadcastId: string): Promise<TicketResult>;
  callToken(broadcastId: string): Promise<CallTokenResult>;
}

/** Any answer the caller does not handle. */
export class BroadcastApiError extends Error {
  constructor(readonly status: number) {
    super(`social API answered ${status}`);
    this.name = "BroadcastApiError";
  }
}

export function createBroadcastApi(host: SurfaceHost): BroadcastApi {
  const client = createApiClient({
    baseUrl: host.config.apiOrigin,
    getToken: async () => (host.viewer.get() ? host.viewer.identityToken().catch(() => null) : null),
    correlationId: () => crypto.randomUUID(),
  });
  const path = (broadcastId: string) => ({ params: { path: { broadcastId } } });
  const parsed = <T>(schema: z.ZodType<T>, data: unknown, status: number): T => {
    const r = schema.safeParse(data);
    if (!r.success) throw new BroadcastApiError(status);
    return r.data;
  };
  return {
    async start(roomId) {
      const { data, response } = await client.POST("/api/v1/rooms/{roomId}/broadcasts", { params: { path: { roomId } } });
      if (data) return { kind: "ok", broadcast: parsed(broadcastSchema, data, response.status) };
      if (response.status === 409) return { kind: "already-live" };
      if (response.status === 403 || response.status === 404) return { kind: "forbidden" };
      throw new BroadcastApiError(response.status);
    },
    async end(broadcastId) {
      const { response } = await client.POST("/api/v1/broadcasts/{broadcastId}/end", path(broadcastId));
      // 404: it has already ended (or never existed); either way it is over.
      if (!response.ok && response.status !== 404) throw new BroadcastApiError(response.status);
    },
    async get(broadcastId) {
      const { data, response } = await client.GET("/api/v1/broadcasts/{broadcastId}", path(broadcastId));
      if (data) return { kind: "ok", broadcast: parsed(broadcastSchema, data, response.status) };
      if (response.status === 404 || response.status === 400) return { kind: "not-found" };
      throw new BroadcastApiError(response.status);
    },
    async ticket(broadcastId) {
      const { data, response } = await client.POST("/api/v1/broadcasts/{broadcastId}/ticket", path(broadcastId));
      if (data) return { kind: "ok", ticket: parsed(ticketSchema, data, response.status) };
      if (response.status === 404 || response.status === 400) return { kind: "ended" };
      throw new BroadcastApiError(response.status);
    },
    async callToken(broadcastId) {
      const { data, response } = await client.POST("/api/v1/broadcasts/{broadcastId}/call/token", path(broadcastId));
      if (data) return { kind: "ok", ...parsed(callTokenSchema, data, response.status) };
      if (response.status === 404 || response.status === 400) return { kind: "not-found" };
      if (response.status === 503) return { kind: "unavailable" };
      if (response.status === 429)
        return { kind: "limited", retryAfterSeconds: Number(response.headers.get("retry-after")) || 5 };
      throw new BroadcastApiError(response.status);
    },
  };
}

const built = new WeakMap<SurfaceHost, BroadcastApi>();

/** The broadcast API built from this host (one per host). */
export function broadcastApiFor(rawHost: SurfaceHost): BroadcastApi {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let api = built.get(host);
  if (!api) {
    api = createBroadcastApi(host);
    built.set(host, api);
  }
  return api;
}

/** Lets tests provide the broadcast API; the surface leaves it empty and gets one built from the host. */
export const BroadcastApiContext = createContext<BroadcastApi | null>(null);

/** The broadcast API for this host, or null in standalone mode with nothing provided. */
export function useBroadcastApi(): BroadcastApi | null {
  const provided = useContext(BroadcastApiContext);
  const host = useHost();
  if (provided) return provided;
  return host ? broadcastApiFor(host) : null;
}
