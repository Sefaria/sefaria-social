// Broadcasts (spec 043; design docs/design/session-recording-and-broadcast.md §6). A room's owner broadcasts its reader and
// call, view only, to anyone signed in who has the link. The server keeps the broadcast, signs the relay tickets that carry the
// caller's role (host or viewer) into the broadcast's relay room `b_<id>`, and mints LiveKit tokens for its call `bcast_<id>`
// (the host publishes, a viewer only subscribes, hidden). Anyone signed in may read a broadcast by id: the id is the link.
import { and, eq, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { relayRoomOf, signTicket, TICKET_TTL_SECONDS, type BroadcastRole } from "../broadcast-ticket";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { broadcasts, userDisplay } from "../db/schema";
import { ApiError } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";
import { callsConfig, mintBroadcastToken, type CallTokenDto } from "./livekit";
import { membership } from "./rooms";
import { upsertDisplay } from "./users";

export interface BroadcastDto {
  id: string;
  roomId: string;
  title: string;
  hostName: string | null;
  status: "live" | "ended";
  startedAt: string;
  /** The page a viewer opens: /social/b/<id>. */
  link: string;
}

export interface BroadcastTicketDto {
  ticket: string;
  role: BroadcastRole;
  relayRoom: string;
  expiresAt: string;
}

export const broadcastLink = (id: string) => `/social/b/${id}`;

type Row = {
  id: string;
  roomId: string;
  hostUserId: number;
  title: string;
  status: string;
  startedAt: Date;
  hostName: string | null;
};

const toDto = (r: Row): BroadcastDto => ({
  id: r.id,
  roomId: r.roomId,
  title: r.title,
  hostName: r.hostName,
  status: r.status === "live" ? "live" : "ended",
  startedAt: r.startedAt.toISOString(),
  link: broadcastLink(r.id),
});

async function find(db: Db, broadcastId: string): Promise<Row> {
  const [row] = await db
    .select({
      id: broadcasts.id,
      roomId: broadcasts.roomId,
      hostUserId: broadcasts.hostUserId,
      title: broadcasts.title,
      status: broadcasts.status,
      startedAt: broadcasts.startedAt,
      hostName: userDisplay.name,
    })
    .from(broadcasts)
    .leftJoin(userDisplay, eq(userDisplay.userId, broadcasts.hostUserId))
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);
  if (!row) throw new ApiError(404, "broadcast.not_found");
  return row;
}

/** A live broadcast, for tickets and call tokens: an ended one is not found. */
async function live(db: Db, broadcastId: string): Promise<Row> {
  const row = await find(db, broadcastId);
  if (row.status !== "live") throw new ApiError(404, "broadcast.not_found");
  return row;
}

const roleOf = (row: Row, identity: Identity): BroadcastRole => (row.hostUserId === identity.userId ? "host" : "viewer");

/** Start broadcasting a room (AC-001): its owner only, one live at a time. */
export async function startBroadcast(identity: Identity, roomId: string, db: Db = getDb()): Promise<BroadcastDto> {
  const m = await membership(db, identity, roomId);
  if (m.role !== "owner") throw new ApiError(403, "room.forbidden");
  const id = await db
    .transaction(async (tx) => {
      await upsertDisplay(tx, identity);
      const [running] = await tx
        .select({ id: broadcasts.id })
        .from(broadcasts)
        .where(and(eq(broadcasts.roomId, roomId), eq(broadcasts.status, "live")))
        .limit(1);
      if (running) throw new ApiError(409, "broadcast.already_live");
      const [row] = await tx
        .insert(broadcasts)
        .values({ roomId, hostUserId: identity.userId, title: m.title })
        .returning({ id: broadcasts.id });
      return row!.id;
    })
    .catch((e: unknown) => {
      // two starts racing: the partial unique index lets one through
      const x = e as { code?: unknown; cause?: { code?: unknown } };
      if (x.code === "23505" || x.cause?.code === "23505") throw new ApiError(409, "broadcast.already_live");
      throw e;
    });
  return toDto(await find(db, id));
}

/** The host ends the broadcast (AC-001). Ending an ended one changes nothing. */
export async function endBroadcast(identity: Identity, broadcastId: string, db: Db = getDb()): Promise<BroadcastDto> {
  const row = await find(db, broadcastId);
  if (row.hostUserId !== identity.userId) throw new ApiError(403, "broadcast.forbidden");
  await db
    .update(broadcasts)
    .set({ status: "ended", endedAt: sql`coalesce(${broadcasts.endedAt}, now())` })
    .where(eq(broadcasts.id, broadcastId));
  return toDto(await find(db, broadcastId));
}

/** A broadcast as its page shows it. Anyone signed in who has the id. */
export async function getBroadcast(_identity: Identity, broadcastId: string, db: Db = getDb()): Promise<BroadcastDto> {
  return toDto(await find(db, broadcastId));
}

/**
 * A relay ticket for the broadcast's room (AC-002): the caller's role (host for its host, viewer for anyone else), valid for
 * TICKET_TTL_SECONDS. 404 for an unknown or ended broadcast; 503 when the relay secret is not configured.
 */
export async function broadcastTicket(
  identity: Identity,
  broadcastId: string,
  db: Db = getDb(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<BroadcastTicketDto> {
  const secret = getConfig().RELAY_INTERNAL_SECRET;
  if (!secret) throw new ApiError(503, "broadcast.unavailable");
  const row = await live(db, broadcastId);
  const role = roleOf(row, identity);
  const exp = nowSeconds + TICKET_TTL_SECONDS;
  const ticket = await signTicket({ b: row.id, sub: String(identity.userId), role, exp }, secret);
  return { ticket, role, relayRoom: relayRoomOf(row.id), expiresAt: new Date(exp * 1000).toISOString() };
}

/** 20 broadcast call tokens per user and broadcast per minute, as for room calls: each is a media-server credential. */
const tokenLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

/** A LiveKit token for the broadcast's call (AC-005): the host publishes, a viewer only watches. */
export async function broadcastCallToken(identity: Identity, broadcastId: string, db: Db = getDb()): Promise<CallTokenDto> {
  const limit = tokenLimiter.hit(`broadcast-token:${identity.userId}:${broadcastId}`);
  if (!limit.allowed) throw new ApiError(429, "request.rate_limited", { "retry-after": String(limit.retryAfterSeconds) });
  const row = await live(db, broadcastId);
  const config = callsConfig();
  if (!config) throw new ApiError(503, "call.unavailable");
  return mintBroadcastToken({
    config,
    broadcastId: row.id,
    userId: identity.userId,
    name: identity.name,
    role: roleOf(row, identity),
  });
}
