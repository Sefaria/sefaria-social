// What the room features need from the social API (spec 011), behind a small interface: the surface builds it from the host
// (host.config.apiOrigin, host.viewer.identityToken()) over @sefaria-social/api-client; component tests give a fake with the
// same methods. Tokens stay in memory, in the host's cache; nothing here stores one.
import { createContext, useContext } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { createApiClient, type paths, type Room } from "@sefaria-social/api-client";

/** A room's live status (spec 011), with its call while one is live (spec 038). */
export type RoomStatus = paths["/api/v1/rooms/{roomId}/status"]["get"]["responses"][200]["content"]["application/json"];
import { useHost } from "~/features/host/host-context";
import { documentHostFor } from "~/features/host/document-host";

export type { Room };

/** `missing` covers both "no such room" and "not a member": the API answers both with 404 so ids cannot be probed. */
export type RoomLookup = { kind: "member"; room: Room } | { kind: "missing" };
export type JoinResult = { kind: "joined"; room: Room } | { kind: "not-found" };
/** A LiveKit token for the room's call (spec 033). Kept in memory only; never stored, logged or put in a URL. */
export type CallTokenResult =
  | { kind: "ok"; url: string; token: string; expiresAt: string }
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "limited"; retryAfterSeconds: number }
  | { kind: "removed" };

export interface RoomsApi {
  getRoom(roomId: string): Promise<RoomLookup>;
  join(roomId: string): Promise<JoinResult>;
  /** Optional so older fakes keep working; the surface's API always has it. */
  getCallToken?(roomId: string): Promise<CallTokenResult>;
  /** The room's live status, with its call while one is live (spec 038); null when it cannot be read. Optional like the above. */
  getStatus?(roomId: string): Promise<RoomStatus | null>;
  /** The owner mutes a participant's track or removes them from the call (spec 039). Optional like the above. */
  moderate?(
    roomId: string,
    action: "mute" | "remove",
    participant: string,
    source?: "microphone" | "camera" | "screen_share",
  ): Promise<"ok" | "not-in-call" | "forbidden" | "unavailable">;
  /** Spec 044: the caller's rooms, newest first. Optional like the above, so older fakes keep working. */
  list?(): Promise<Room[]>;
  /** Spec 044: create a room owned by the caller. */
  create?(title: string): Promise<Room>;
  /** Spec 044: rename a room (owner only). */
  rename?(roomId: string, title: string): Promise<Room>;
  /** Spec 044: delete a room and everything in it (owner only). */
  remove?(roomId: string): Promise<void>;
  /** Spec 044: leave a room (not its owner). */
  leave?(roomId: string): Promise<void>;
  /** Spec 048: a relay ticket naming the caller's role in the room; null when there is none to have (not a member, no relay). */
  ticket?(roomId: string): Promise<RoomTicket | null>;
  /** Spec 058: invite people by @handle or email; one result per entry. Optional like the above. */
  invite?(roomId: string, to: string[]): Promise<InviteOutcome>;
  /** Spec 058: people for the invite bar's suggestions. */
  people?(q: string): Promise<Person[]>;
}

/** Spec 058: what happened to each entry of an invitation, in order. */
export type InviteStatus = "invited" | "member" | "self" | "not_found" | "invalid" | "unavailable" | "failed";
export type InviteOutcome =
  | { kind: "ok"; results: { to: string; status: InviteStatus }[] }
  | { kind: "limited"; retryAfterSeconds: number }
  | { kind: "not-found" };
export type Person = { id: string; handle: string; name: string; kind: "person" };

/** A relay ticket for an ordinary room (spec 048). A bearer credential: kept in memory, never stored, logged or put in a URL. */
export type RoomTicket = { ticket: string; role: "owner" | "member"; expiresAt: string };

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
    async moderate(roomId, action, participant, source) {
      const { response } =
        action === "mute"
          ? await client.POST("/api/v1/rooms/{roomId}/call/mute", {
              params: { path: { roomId } },
              body: { participant, source: source ?? "microphone" },
            })
          : await client.POST("/api/v1/rooms/{roomId}/call/remove", { params: { path: { roomId } }, body: { participant } });
      if (response.status === 204) return "ok";
      if (response.status === 404) return "not-in-call";
      if (response.status === 403) return "forbidden";
      if (response.status === 503) return "unavailable";
      throw new RoomsApiError(response.status);
    },
    async getStatus(roomId) {
      const { data } = await client.GET("/api/v1/rooms/{roomId}/status", { params: { path: { roomId } } });
      return data ?? null;
    },
    async getCallToken(roomId) {
      const { data, response } = await client.POST("/api/v1/rooms/{roomId}/call/token", { params: { path: { roomId } } });
      if (data) return { kind: "ok", ...data };
      if (response.status === 404 || response.status === 400) return { kind: "not-found" };
      if (response.status === 503) return { kind: "unavailable" };
      if (response.status === 403) return { kind: "removed" };
      if (response.status === 429)
        return { kind: "limited", retryAfterSeconds: Number(response.headers.get("retry-after")) || 5 };
      throw new RoomsApiError(response.status);
    },
    async list() {
      const { data, response } = await client.GET("/api/v1/rooms");
      if (data) return data.rooms;
      throw new RoomsApiError(response.status);
    },
    async create(title) {
      const { data, response } = await client.POST("/api/v1/rooms", { body: { title } });
      if (data) return data;
      throw new RoomsApiError(response.status);
    },
    async rename(roomId, title) {
      const { data, response } = await client.PATCH("/api/v1/rooms/{roomId}", { params: { path: { roomId } }, body: { title } });
      if (data) return data;
      throw new RoomsApiError(response.status);
    },
    async remove(roomId) {
      const { response } = await client.DELETE("/api/v1/rooms/{roomId}", { params: { path: { roomId } } });
      if (response.status !== 204) throw new RoomsApiError(response.status);
    },
    async leave(roomId) {
      const { response } = await client.DELETE("/api/v1/rooms/{roomId}/members/me", { params: { path: { roomId } } });
      if (response.status !== 204) throw new RoomsApiError(response.status);
    },
    async ticket(roomId) {
      const { data, response } = await client.POST("/api/v1/rooms/{roomId}/ticket", { params: { path: { roomId } } });
      if (data) return { ticket: data.ticket, role: data.role, expiresAt: data.expiresAt };
      if (response.status === 404 || response.status === 400 || response.status === 503) return null;
      throw new RoomsApiError(response.status);
    },
    async invite(roomId, to) {
      const { data, response } = await client.POST("/api/v1/rooms/{roomId}/invites", {
        params: { path: { roomId } },
        body: { to },
      });
      if (data) return { kind: "ok", results: data.results };
      if (response.status === 429)
        return { kind: "limited", retryAfterSeconds: Number(response.headers.get("retry-after")) || 3600 };
      if (response.status === 404) return { kind: "not-found" };
      throw new RoomsApiError(response.status);
    },
    async people(q) {
      const { data } = await client.GET("/api/v1/people", { params: { query: { q } } });
      return data?.people ?? [];
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

/** The rooms API built from this host (one per host). */
export function roomsApiFor(rawHost: SurfaceHost): RoomsApi {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let api = built.get(host);
  if (!api) {
    api = createRoomsApi(host);
    built.set(host, api);
  }
  return api;
}

/** The rooms API for this host, or null in standalone mode with nothing provided. */
export function useRoomsApi(): RoomsApi | null {
  const provided = useContext(RoomsApiContext);
  const host = useHost();
  if (provided) return provided;
  if (!host) return null;
  return roomsApiFor(host);
}
