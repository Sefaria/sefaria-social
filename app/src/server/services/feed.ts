// The feed (spec 015): what is live, scheduled and recent for the viewer, in one request, so the feed page opens no
// connection to any room (plan 4.5). Live means the relay's status read has someone in the room; that read happens for each
// of the viewer's most recently updated rooms, in parallel, outside any transaction, and falls back to "not live".
import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { roomMembers, rooms, shiurim } from "../db/schema";
import { relayStatus } from "./relay";
import { liveCalls, type CallStatusDto } from "./calls";

/** At most this many items per section, and at most this many status reads per request. */
export const FEED_LIMIT = 20;

export interface LiveRoomDto {
  id: string;
  title: string;
  ref: string | null;
  heRef: string | null;
  sourceTitle: string | null;
  participants: number;
  call?: CallStatusDto;
}

export interface RecentRoomDto {
  id: string;
  title: string;
  updatedAt: string;
  call?: CallStatusDto;
}

export interface ScheduledShiurDto {
  id: string;
  title: string;
  ref: string | null;
  roomId: string | null;
  scheduledAt: string;
}

export interface FeedDto {
  live: LiveRoomDto[];
  scheduled: ScheduledShiurDto[];
  recent: RecentRoomDto[];
}

export async function getFeed(identity: Identity, db: Db = getDb()): Promise<FeedDto> {
  const myRooms = await db
    .select({ id: rooms.id, title: rooms.title, updatedAt: rooms.updatedAt })
    .from(roomMembers)
    .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
    .where(eq(roomMembers.userId, identity.userId))
    .orderBy(desc(rooms.updatedAt), desc(rooms.id))
    .limit(FEED_LIMIT * 2);

  const memberOfShiurRoom = sql`exists (select 1 from ${roomMembers} where ${roomMembers.roomId} = ${shiurim.roomId} and ${roomMembers.userId} = ${identity.userId})`;
  const shiurRows = await db
    .select({ id: shiurim.id, title: shiurim.title, ref: shiurim.ref, roomId: shiurim.roomId, scheduledAt: shiurim.scheduledAt })
    .from(shiurim)
    .where(
      and(
        gt(shiurim.scheduledAt, sql`now()`),
        or(eq(shiurim.visibility, "public"), eq(shiurim.teacherUserId, identity.userId), memberOfShiurRoom),
      ),
    )
    .orderBy(asc(shiurim.scheduledAt), asc(shiurim.id))
    .limit(FEED_LIMIT);

  // Status reads only for the rooms that can still make a section (outside any transaction; each falls back to offline).
  const asked = myRooms.slice(0, FEED_LIMIT);
  const [statuses, calls] = await Promise.all([
    Promise.all(asked.map((r) => relayStatus(r.id))),
    liveCalls(
      myRooms.map((r) => r.id),
      db,
    ),
  ]);
  /** `{ call }` while the room's call is live, else nothing (spec 038 AC-004). */
  const callOf = (id: string) => {
    const call = calls.get(id);
    return call ? { call } : {};
  };
  const live: LiveRoomDto[] = [];
  const recent: RecentRoomDto[] = [];
  myRooms.forEach((r, i) => {
    const s = statuses[i];
    if (s?.live)
      live.push({
        id: r.id,
        title: r.title,
        ref: s.ref,
        heRef: s.heRef,
        sourceTitle: s.title,
        participants: s.participants,
        ...callOf(r.id),
      });
    else if (recent.length < FEED_LIMIT)
      recent.push({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString(), ...callOf(r.id) });
  });

  return {
    live,
    scheduled: shiurRows.map((s) => ({
      id: s.id,
      title: s.title,
      ref: s.ref,
      roomId: s.roomId,
      scheduledAt: s.scheduledAt!.toISOString(),
    })),
    recent,
  };
}
