// The API's contracts: every endpoint the server serves, with its zod schemas (plan section 6.2). Route files bind these to
// handlers; the OpenAPI document (packages/api-client/openapi.json) and the generated client are produced from this list.
// Adding an endpoint: declare it here, add it to ENDPOINTS, bind it in its route file, then `npm run api:generate`.
import { z } from "zod";
import { defineEndpoint } from "../http/endpoint";

export const Health = z.object({
  status: z.enum(["ok", "unavailable"]),
  database: z.enum(["ok", "unavailable"]),
});

export const Room = z.object({
  id: z.uuid(),
  title: z.string(),
  ownerUserId: z.int().positive(),
  role: z.enum(["owner", "member"]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const RoomStatus = z.object({
  live: z.boolean(),
  ref: z.string().nullable(),
  heRef: z.string().nullable(),
  title: z.string().nullable(),
  participants: z.int().nonnegative(),
});

const Iso = z.iso.datetime({ offset: true });

export const Feed = z.object({
  live: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      ref: z.string().nullable(),
      heRef: z.string().nullable(),
      sourceTitle: z.string().nullable(),
      participants: z.int().positive(),
    }),
  ),
  scheduled: z.array(
    z.object({ id: z.uuid(), title: z.string(), ref: z.string().nullable(), roomId: z.uuid().nullable(), scheduledAt: Iso }),
  ),
  recent: z.array(z.object({ id: z.uuid(), title: z.string(), updatedAt: Iso })),
});

export const Me = z.object({ userId: z.int().positive(), name: z.string() });

export const RoomList = z.object({ rooms: z.array(Room) });

export const RoomInput = z.strictObject({ title: z.string().trim().min(1).max(120) });

const RoomParams = z.object({ roomId: z.uuid() });

export const UserDeletedEvent = z.looseObject({
  event: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
  occurred_at: z.string().max(40),
  user_id: z.int().positive().optional(),
});

export const WebhookAck = z.object({ status: z.enum(["processed", "duplicate", "ignored"]) });

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const getHealth = defineEndpoint({
  operationId: "getHealth",
  method: "GET",
  path: "/api/v1/health",
  summary: "Database health, for load balancers. Public.",
  tags: ["ops"],
  access: "public",
  responses: {
    200: { description: "The database answers.", schema: Health },
    503: { description: "The database does not answer within 2 seconds.", schema: Health },
  },
});

export const getMe = defineEndpoint({
  operationId: "getMe",
  method: "GET",
  path: "/api/v1/me",
  summary: "Who the token says the caller is. Proves a session is authenticated (spec 082).",
  tags: ["identity"],
  responses: { 200: { description: "The caller.", schema: Me } },
});

export const listRooms = defineEndpoint({
  operationId: "listRooms",
  method: "GET",
  path: "/api/v1/rooms",
  summary: "Rooms the caller is a member of, newest first.",
  tags: ["rooms"],
  responses: { 200: { description: "The caller's rooms.", schema: RoomList } },
});

export const createRoom = defineEndpoint({
  operationId: "createRoom",
  method: "POST",
  path: "/api/v1/rooms",
  summary: "Create a room owned by the caller.",
  tags: ["rooms"],
  body: RoomInput,
  responses: { 201: { description: "The new room; the caller is its owner.", schema: Room } },
});

export const getRoom = defineEndpoint({
  operationId: "getRoom",
  method: "GET",
  path: "/api/v1/rooms/{roomId}",
  summary: "A room the caller is a member of.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room.", schema: Room } },
});

export const renameRoom = defineEndpoint({
  operationId: "renameRoom",
  method: "PATCH",
  path: "/api/v1/rooms/{roomId}",
  summary: "Rename a room. Owner only.",
  tags: ["rooms"],
  params: RoomParams,
  body: RoomInput,
  errors: [403, 404],
  responses: { 200: { description: "The renamed room.", schema: Room } },
});

export const deleteRoom = defineEndpoint({
  operationId: "deleteRoom",
  method: "DELETE",
  path: "/api/v1/rooms/{roomId}",
  summary: "Delete a room and its memberships. Owner only.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [403, 404],
  responses: { 204: { description: "Deleted." } },
});

export const joinRoom = defineEndpoint({
  operationId: "joinRoom",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/members",
  summary: "Join a room. The room id is the invitation: any signed-in user who has it may join. Idempotent.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room, with the caller's role.", schema: Room } },
});

export const leaveRoom = defineEndpoint({
  operationId: "leaveRoom",
  method: "DELETE",
  path: "/api/v1/rooms/{roomId}/members/me",
  summary: "Leave a room. The owner cannot leave (delete the room instead).",
  tags: ["rooms"],
  params: RoomParams,
  errors: [403, 404],
  responses: { 204: { description: "Left." } },
});

export const getRoomStatus = defineEndpoint({
  operationId: "getRoomStatus",
  method: "GET",
  path: "/api/v1/rooms/{roomId}/status",
  summary:
    "What a room is learning now and how many are in it, from the relay. Members only. Not live when the relay is unreachable.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room's live status.", schema: RoomStatus } },
});

export const getFeed = defineEndpoint({
  operationId: "getFeed",
  method: "GET",
  path: "/api/v1/feed",
  summary:
    "The viewer's feed: their live rooms (with what is being learned and how many are in each), upcoming shiurim they may attend, and their other rooms. At most 20 per section.",
  tags: ["feed"],
  responses: { 200: { description: "The feed.", schema: Feed } },
});

export const userDeleted = defineEndpoint({
  operationId: "userDeletedWebhook",
  method: "POST",
  path: "/api/v1/internal/user-deleted",
  summary: "Django's account-deletion webhook. Authenticated by X-Sefaria-Signature (HMAC-SHA256 of the raw body).",
  tags: ["internal"],
  access: "sefaria-webhook",
  body: UserDeletedEvent,
  responses: { 200: { description: "Processed, already processed, or an event type social ignores.", schema: WebhookAck } },
});

/** Every endpoint, in document order. The route-enumeration test checks this list against the served route tree. */
export const ENDPOINTS = [
  getHealth,
  getMe,
  listRooms,
  createRoom,
  getRoom,
  renameRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  getRoomStatus,
  getFeed,
  userDeleted,
] as const;
