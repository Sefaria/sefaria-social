// Rooms (spec 007). Every read or write by id looks up the caller's membership first: not a member (or no such room) is
// room.not_found, so ids cannot be probed; a member who is not the owner is room.forbidden for owner-only changes.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { roomMembers, rooms } from "../db/schema";
import { ApiError } from "../http/errors";
import { callsAvailable, callsConfig, mintCallToken, type CallTokenDto } from "./livekit";
import { relayStatus, type RoomStatusDto } from "./relay";
import { upsertDisplay } from "./users";

export interface RoomDto {
  id: string;
  title: string;
  ownerUserId: number;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
  calls: { available: boolean };
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

async function membership(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], identity: Identity, roomId: string) {
  const [row] = await db
    .select(columns)
    .from(roomMembers)
    .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, identity.userId)))
    .limit(1);
  if (!row) throw new ApiError(404, "room.not_found");
  return row;
}

export async function getRoom(identity: Identity, roomId: string, db: Db = getDb()): Promise<RoomDto> {
  return toDto(await membership(db, identity, roomId));
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
export async function getRoomStatus(identity: Identity, roomId: string, db: Db = getDb()): Promise<RoomStatusDto> {
  await membership(db, identity, roomId);
  return relayStatus(roomId);
}

/**
 * A LiveKit token for the room's call (spec 033). Members only (a non-member and a missing room look the same); the role
 * comes from the membership row. The display cache is refreshed from the token, as on joining. Minting is local and runs
 * after the database work, outside any transaction.
 */
export async function getCallToken(identity: Identity, roomId: string, db: Db = getDb()): Promise<CallTokenDto> {
  const m = await db.transaction(async (tx) => {
    const row = await membership(tx, identity, roomId);
    await upsertDisplay(tx, identity);
    return row;
  });
  const config = callsConfig();
  if (!config) throw new ApiError(503, "call.unavailable");
  return mintCallToken({
    config,
    roomId,
    userId: identity.userId,
    name: identity.name,
    role: m.role === "owner" ? "owner" : "member",
  });
}
