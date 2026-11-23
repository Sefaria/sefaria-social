// What the room features need from the social API (spec 011), behind a small interface: the surface builds it from the host
// (host.config.apiOrigin, host.viewer.identityToken()) over @sefaria-social/api-client; component tests give a fake with the
// same methods. Tokens stay in memory, in the host's cache; nothing here stores one.
import { createContext, useContext } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { createApiClient, type Room } from "@sefaria-social/api-client";
import { useHost } from "~/features/host/host-context";

export type { Room };

/** `missing` covers both "no such room" and "not a member": the API answers both with 404 so ids cannot be probed. */
export type RoomLookup = { kind: "member"; room: Room } | { kind: "missing" };
export type JoinResult = { kind: "joined"; room: Room } | { kind: "not-found" };

export interface RoomsApi {
  getRoom(roomId: string): Promise<RoomLookup>;
  join(roomId: string): Promise<JoinResult>;
}

/** The API's error for anything other than the statuses a caller handles. */
export class RoomsApiError extends Error {
  constructor(readonly status: number) {
    super(`social API answered ${status}`);
    this.name = "RoomsApiError";
  }
}

export function createRoomsApi(host: SurfaceHost): RoomsApi {
  const client = createApiClient({
    baseUrl: host.config.apiOrigin,
    getToken: async () => (host.viewer.get() ? host.viewer.identityToken().catch(() => null) : null),
    correlationId: () => crypto.randomUUID(),
  });
  return {
    async getRoom(roomId) {
      const { data, response } = await client.GET("/api/v1/rooms/{roomId}", { params: { path: { roomId } } });
      if (data) return { kind: "member", room: data };
      if (response.status === 404 || response.status === 400) return { kind: "missing" };
      throw new RoomsApiError(response.status);
    },
    async join(roomId) {
      const { data, response } = await client.POST("/api/v1/rooms/{roomId}/members", { params: { path: { roomId } } });
      if (data) return { kind: "joined", room: data };
      if (response.status === 404 || response.status === 400) return { kind: "not-found" };
      throw new RoomsApiError(response.status);
    },
  };
}

/** Lets tests (and later the standalone pages) provide the API; the surface leaves it empty and gets one built from the host. */
export const RoomsApiContext = createContext<RoomsApi | null>(null);

const built = new WeakMap<SurfaceHost, RoomsApi>();

/** The rooms API for this host, or null in standalone mode with nothing provided. */
export function useRoomsApi(): RoomsApi | null {
  const provided = useContext(RoomsApiContext);
  const host = useHost();
  if (provided) return provided;
  if (!host) return null;
  let api = built.get(host);
  if (!api) {
    api = createRoomsApi(host);
    built.set(host, api);
  }
  return api;
}
