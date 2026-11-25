// Rooms (spec 007). Every read or write by id looks up the caller's membership first: not a member (or no such room) is
// room.not_found, so ids cannot be probed; a member who is not the owner is room.forbidden for owner-only changes.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { signTicket, TICKET_TTL_SECONDS, type RoomRole } from "../broadcast-ticket";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { broadcasts, callRemovals, roomMembers, rooms } from "../db/schema";
import { ApiError } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";
import {
  callsAvailable,
  callsConfig,
  livekitIdentity,
  mintCallToken,
  muteTrack,
  removeFromCall,
  type CallTokenDto,
  type ModeratedSource,
} from "./livekit";
import { relayStatus, type RoomStatusDto } from "./relay";
import { liveCalls, type CallStatusDto } from "./calls";
import { recordingOf } from "./recordings";
import { upsertDisplay } from "./users";

export interface RoomDto {
  id: string;
  title: string;
  ownerUserId: number;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
  calls: { available: boolean };
  /** Present (true) only while the room is being recorded (spec 041 AC-006), so other reads are unchanged. */
  recording?: true;
  /** The live broadcast, present only while one is live (spec 043), so other reads are unchanged. */
  broadcast?: { id: string; link: string };
}

/** `{ broadcast }` while the room has a live broadcast, nothing otherwise (spec 043: the host's panel finds it after a reload). */
async function broadcastField(roomId: string, db: Db): Promise<{ broadcast?: { id: string; link: string } }> {
  const [row] = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.roomId, roomId), eq(broadcasts.status, "live")))
    .limit(1);
  return row ? { broadcast: { id: row.id, link: `/social/b/${row.id}` } } : {};
}

/** `{ recording: true }` while the room is being recorded, nothing otherwise (spec 041 AC-006). */
async function recordingField(roomId: string, db: Db): Promise<{ recording?: true }> {
  return (await recordingOf([roomId], db)).has(roomId) ? { recording: true } : {};
}

const columns = {
  id: rooms.id,
  title: rooms.title,
  ownerUserId: rooms.ownerUserId,
  role: roomMembers.role,
  createdAt: rooms.createdAt,
  updatedAt: rooms.updatedAt,
};

type Row = { id: string; title: string; ownerUserId: number; role: string; createdAt: Date; updatedAt: Date };

const toDto = (r: Row): RoomDto => ({
  id: r.id,
  title: r.title,
  ownerUserId: r.ownerUserId,
  role: r.role === "owner" ? "owner" : "member",
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  calls: { available: callsAvailable() },
});

export async function createRoom(identity: Identity, title: string, db: Db = getDb()): Promise<RoomDto> {
  return db.transaction(async (tx) => {
    await upsertDisplay(tx, identity);
    const [room] = await tx.insert(rooms).values({ ownerUserId: identity.userId, title }).returning();
    await tx.insert(roomMembers).values({ roomId: room!.id, userId: identity.userId, role: "owner" });
    return toDto({ ...room!, role: "owner" });
  });
}

export async function listRooms(identity: Identity, db: Db = getDb()): Promise<RoomDto[]> {
  const rows = await db
    .select(columns)
    .from(roomMembers)
    .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
    .where(eq(roomMembers.userId, identity.userId))
    .orderBy(desc(rooms.createdAt), desc(rooms.id));
  return rows.map(toDto);
}

export async function membership(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], identity: Identity, roomId: string) {
  const [row] = await db
    .select(columns)
    .from(roomMembers)
    .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, identity.userId)))
    .limit(1);
  if (!row) throw new ApiError(404, "room.not_found");
  return row;
}

export interface RoomTicketDto {
  ticket: string;
  role: RoomRole;
  relayRoom: string;
  expiresAt: string;
}

/**
 * A relay ticket for an ordinary room (spec 048 AC-004): the caller's role, `owner` for the room's owner (who leads) and
 * `member` for anyone else in it, valid for TICKET_TTL_SECONDS. 404 for a room the caller is not in; 503 when the relay secret
 * is not configured. The relay makes only an owner ticket a host (AC-005).
 */
export async function roomTicket(
  identity: Identity,
  roomId: string,
  db: Db = getDb(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<RoomTicketDto> {
  const m = await membership(db, identity, roomId);
  const secret = getConfig().RELAY_INTERNAL_SECRET;
  if (!secret) throw new ApiError(503, "room.relay_unavailable");
  const role: RoomRole = m.role === "owner" ? "owner" : "member";
  const exp = nowSeconds + TICKET_TTL_SECONDS;
  const ticket = await signTicket({ b: roomId, sub: String(identity.userId), role, exp }, secret);
  return { ticket, role, relayRoom: roomId, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function getRoom(identity: Identity, roomId: string, db: Db = getDb()): Promise<RoomDto> {
  const room = toDto(await membership(db, identity, roomId));
  return { ...room, ...(await recordingField(roomId, db)), ...(await broadcastField(roomId, db)) };
}

export async function renameRoom(identity: Identity, roomId: string, title: string, db: Db = getDb()): Promise<RoomDto> {
  return db.transaction(async (tx) => {
    const m = await membership(tx, identity, roomId);
    if (m.role !== "owner") throw new ApiError(403, "room.forbidden");
    const [room] = await tx
      .update(rooms)
      .set({ title, updatedAt: sql`now()` })
      .where(eq(rooms.id, roomId))
      .returning();
    return toDto({ ...room!, role: "owner" });
  });
}

export async function deleteRoom(identity: Identity, roomId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await membership(tx, identity, roomId);
    if (m.role !== "owner") throw new ApiError(403, "room.forbidden");
    await tx.delete(rooms).where(eq(rooms.id, roomId)); // memberships go with it (on delete cascade)
  });
}

/**
 * Join a room (spec 011). The room id is a random UUID and acts as the invitation: any signed-in user who holds it may join.
 * Idempotent: a member (or the owner) gets the room back unchanged. A room that does not exist is room.not_found.
 */
export async function joinRoom(identity: Identity, roomId: string, db: Db = getDb()): Promise<RoomDto> {
  return db.transaction(async (tx) => {
    const [room] = await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).limit(1);
    if (!room) throw new ApiError(404, "room.not_found");
    await upsertDisplay(tx, identity);
    await tx.insert(roomMembers).values({ roomId, userId: identity.userId, role: "member" }).onConflictDoNothing();
    return toDto(await membership(tx, identity, roomId));
  });
}

/** Leave a room (spec 011). The owner cannot leave; a non-member gets room.not_found. */
export async function leaveRoom(identity: Identity, roomId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await membership(tx, identity, roomId);
    if (m.role === "owner") throw new ApiError(403, "room.owner_cannot_leave");
    await tx.delete(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, identity.userId)));
  });
}

/** A room's live status (spec 011): members only, then the relay's status read (outside any transaction). */
export async function getRoomStatus(
  identity: Identity,
  roomId: string,
  db: Db = getDb(),
): Promise<RoomStatusDto & { call?: CallStatusDto; recording?: true }> {
  await membership(db, identity, roomId);
  const [relay, calls, recording] = await Promise.all([relayStatus(roomId), liveCalls([roomId], db), recordingField(roomId, db)]);
  const call = calls.get(roomId);
  return { ...(call ? { ...relay, call } : relay), ...recording };
}

/** 20 call tokens per user and room per minute (spec 033 AC-006): each one is a credential for the media server. */
const callTokenLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

/**
 * A LiveKit token for the room's call (spec 033). Members only (a non-member and a missing room look the same); the role
 * comes from the membership row. The display cache is refreshed from the token, as on joining. Minting is local and runs
 * after the database work, outside any transaction.
 */
export async function getCallToken(identity: Identity, roomId: string, db: Db = getDb()): Promise<CallTokenDto> {
  const limit = callTokenLimiter.hit(`call-token:${identity.userId}:${roomId}`);
  if (!limit.allowed) throw new ApiError(429, "request.rate_limited", { "retry-after": String(limit.retryAfterSeconds) });
  const m = await db.transaction(async (tx) => {
    const row = await membership(tx, identity, roomId);
    await upsertDisplay(tx, identity);
    return row;
  });
  const config = callsConfig();
  if (!config) throw new ApiError(503, "call.unavailable");
  // spec 039: the owner removed them from this call a short while ago
  const [removed] = await db
    .select({ until: callRemovals.until })
    .from(callRemovals)
    .where(and(eq(callRemovals.roomId, roomId), eq(callRemovals.userId, identity.userId), sql`${callRemovals.until} > now()`))
    .limit(1);
  if (removed) throw new ApiError(403, "call.removed");
  return mintCallToken({
    config,
    roomId,
    userId: identity.userId,
    name: identity.name,
    role: m.role === "owner" ? "owner" : "member",
  });
}

/** How long a participant the owner removed is refused new call tokens for the room (spec 039 AC-003). */
export const REMOVAL_MINUTES = 15;

const IDENTITY = /^u:([1-9][0-9]{0,15})$/;

/** The checks every moderation shares (spec 039 AC-004, AC-005): calls on, a member, the owner, a well-formed identity. */
async function moderation(identity: Identity, roomId: string, participant: string, db: Db) {
  const config = callsConfig();
  if (!config) throw new ApiError(503, "call.unavailable");
  const m = await membership(db, identity, roomId);
  if (m.role !== "owner") throw new ApiError(403, "room.forbidden");
  const userId = Number(IDENTITY.exec(participant)?.[1]);
  if (!Number.isSafeInteger(userId) || livekitIdentity(userId) !== participant)
    throw new ApiError(404, "call.participant_not_found");
  return { config, userId };
}

/** The owner mutes one of a participant's tracks (spec 039 AC-001). */
export async function muteParticipant(
  identity: Identity,
  roomId: string,
  participant: string,
  source: ModeratedSource,
  db: Db = getDb(),
): Promise<void> {
  const { config } = await moderation(identity, roomId, participant, db);
  if ((await muteTrack(config, roomId, participant, source)) === "not-in-call")
    throw new ApiError(404, "call.participant_not_found");
}

/** The owner removes a participant from the call; they stay a member, and new call tokens are refused for a while (AC-002, AC-003). */
export async function removeParticipant(
  identity: Identity,
  roomId: string,
  participant: string,
  db: Db = getDb(),
): Promise<void> {
  const { config, userId } = await moderation(identity, roomId, participant, db);
  // Recorded first, so a token request racing the removal is already refused.
  await db
    .insert(callRemovals)
    .values({ roomId, userId, until: sql`now() + make_interval(mins => ${REMOVAL_MINUTES})` })
    .onConflictDoUpdate({
      target: [callRemovals.roomId, callRemovals.userId],
      set: { until: sql`now() + make_interval(mins => ${REMOVAL_MINUTES})` },
    });
  if ((await removeFromCall(config, roomId, participant)) === "not-in-call")
    throw new ApiError(404, "call.participant_not_found");
}
