// Live cards (spec 056; decision 0013): the relay reports what each room's leader is on, and anyone may read the live state of
// the rooms, broadcasts and recordings that posts embed. A report is kept per relay room (a room's id, or `b_<broadcast id>`),
// newest by the relay's own timestamp; one older than 5 minutes is refused. A room counts as live only with a report under 3
// minutes old and people connected (and a broadcast only while it is live). Where no fresh report exists the server reads the
// relay's status route instead, so cards work before a relay has SOCIAL_SERVER_URL. Answers are cached for 5 seconds per id.
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { broadcasts, liveStatus, posts, rooms } from "../db/schema";
import { ApiError } from "../http/errors";
import { relayStatus } from "./relay";

export const REPORT_MAX_AGE_MS = 5 * 60_000;
export const LIVE_FRESH_MS = 3 * 60_000;
export const CACHE_MS = 5_000;

export type LiveKind = "room" | "broadcast" | "recording";

export interface LiveReportInput {
  room: string;
  at: number;
  ref: string | null;
  heRef: string | null;
  title: string | null;
  participants: number;
}

export interface LiveStatusDto {
  id: string;
  kind: LiveKind;
  live: boolean;
  ref: string | null;
  heRef: string | null;
  here: number;
  updatedAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const cache = new Map<string, { at: number; value: LiveStatusDto | null }>();

/** The room a relay room belongs to: the room itself, or a broadcast's room; null when neither exists. */
async function roomOf(db: Db, relayRoom: string): Promise<string | null> {
  const broadcastId = relayRoom.startsWith("b_") ? relayRoom.slice(2) : null;
  if (broadcastId !== null) {
    if (!UUID.test(broadcastId)) return null;
    const [b] = await db.select({ roomId: broadcasts.roomId }).from(broadcasts).where(eq(broadcasts.id, broadcastId));
    return b?.roomId ?? null;
  }
  if (!UUID.test(relayRoom)) return null;
  const [r] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, relayRoom));
  return r?.id ?? null;
}

/** How far ahead of ours a relay's clock may be: a report from the future would block correct ones until then. */
export const REPORT_MAX_AHEAD_MS = 30_000;
/** At most this many relay status reads at once for one request (the fallback, decision 0013). */
const RELAY_READS_AT_ONCE = 5;

/**
 * Keep a signed report (the wrapper checked the signature). Refuses one older than 5 minutes or more than 30 seconds ahead;
 * ignores unknown rooms.
 */
export async function receiveReport(input: LiveReportInput, db: Db = getDb(), now = Date.now()): Promise<void> {
  if (now - input.at > REPORT_MAX_AGE_MS || input.at - now > REPORT_MAX_AHEAD_MS)
    throw new ApiError(401, "webhook.bad_signature");
  const roomId = await roomOf(db, input.room);
  if (!roomId) return;
  const row = {
    relayRoom: input.room,
    roomId,
    ref: input.ref,
    heRef: input.heRef,
    title: input.title,
    participants: input.participants,
    reportedAt: new Date(input.at),
  };
  await db
    .insert(liveStatus)
    .values(row)
    .onConflictDoUpdate({
      target: liveStatus.relayRoom,
      set: { ref: row.ref, heRef: row.heRef, title: row.title, participants: row.participants, reportedAt: row.reportedAt },
      setWhere: sql`${liveStatus.reportedAt} < ${row.reportedAt.toISOString()}::timestamptz`,
    });
  // After the write, so a read in between cannot cache the old row again: this server answers the new state at once.
  cache.delete(input.room.startsWith("b_") ? input.room.slice(2) : input.room);
}

// ── The public read ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Forget cached answers (tests). */
export function clearLiveCache(): void {
  cache.clear();
}

/** What a post embeds under each of these ids (one kind per id; ids are uuids, unique across tables). */
async function embeddedKinds(db: Db, ids: string[]): Promise<Map<string, LiveKind>> {
  const rows = await db
    .selectDistinct({ id: posts.embedId, kind: posts.embedKind })
    .from(posts)
    // A Claude asset (spec 063) has no live state: it is left out like an id no post embeds.
    .where(
      and(inArray(posts.embedId, ids), isNotNull(posts.embedKind), sql`${posts.embedKind} <> 'asset'`, isNull(posts.deletedAt)),
    );
  return new Map(rows.map((r) => [r.id!, r.kind as LiveKind]));
}

/** Run `fn` over `items`, at most `n` at a time. */
async function inBatches<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
}

/** The status of these posted ids: three queries for the whole batch, and relay reads only where no fresh report exists. */
async function statusesOf(db: Db, kinds: Map<string, LiveKind>, now: number): Promise<Map<string, LiveStatusDto>> {
  const out = new Map<string, LiveStatusDto>();
  const sessions: { id: string; kind: LiveKind; relayRoom: string }[] = [];
  for (const [id, kind] of kinds) {
    out.set(id, { id, kind, live: false, ref: null, heRef: null, here: 0, updatedAt: null });
    if (kind !== "recording") sessions.push({ id, kind, relayRoom: kind === "broadcast" ? `b_${id}` : id });
  }
  if (!sessions.length) return out;
  const broadcastIds = sessions.filter((x) => x.kind === "broadcast").map((x) => x.id);
  const [liveBroadcasts, rows] = await Promise.all([
    broadcastIds.length
      ? db
          .select({ id: broadcasts.id })
          .from(broadcasts)
          .where(and(inArray(broadcasts.id, broadcastIds), eq(broadcasts.status, "live")))
      : Promise.resolve([]),
    db
      .select()
      .from(liveStatus)
      .where(
        inArray(
          liveStatus.relayRoom,
          sessions.map((x) => x.relayRoom),
        ),
      ),
  ]);
  const broadcastLive = new Set(liveBroadcasts.map((b) => b.id));
  const byRoom = new Map(rows.map((r) => [r.relayRoom, r]));
  const unreported: { id: string; relayRoom: string }[] = [];
  for (const x of sessions) {
    const open = x.kind !== "broadcast" || broadcastLive.has(x.id);
    const row = byRoom.get(x.relayRoom);
    const base = out.get(x.id)!;
    if (row && now - row.reportedAt.getTime() < LIVE_FRESH_MS) {
      const live = open && row.participants > 0;
      out.set(x.id, {
        ...base,
        live,
        ref: row.ref,
        heRef: row.heRef,
        here: live ? row.participants : 0,
        updatedAt: row.reportedAt.toISOString(),
      });
      continue;
    }
    if (row) out.set(x.id, { ...base, ref: row.ref, heRef: row.heRef, updatedAt: row.reportedAt.toISOString() });
    if (open) unreported.push(x);
  }
  // No fresh report: the relay's status route, when the server knows the relay (decision 0013). Its answer has no time of
  // its own, so updatedAt stays as it was (the ETag does not change with every read).
  await inBatches(unreported, RELAY_READS_AT_ONCE, async (x) => {
    const read = await relayStatus(x.relayRoom);
    if (read.live) out.set(x.id, { ...out.get(x.id)!, live: true, ref: read.ref, heRef: read.heRef, here: read.participants });
  });
  return out;
}

/** The live state of each id that a post embeds, in the order asked; other ids are left out. */
export async function liveStatuses(ids: string[], db: Db = getDb(), now = Date.now()): Promise<LiveStatusDto[]> {
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => {
    const hit = cache.get(id);
    return !hit || now - hit.at >= CACHE_MS;
  });
  if (missing.length) {
    const found = await statusesOf(db, await embeddedKinds(db, missing), now);
    for (const id of missing) cache.set(id, { at: now, value: found.get(id) ?? null });
  }
  if (cache.size > 10_000) for (const [id, hit] of cache) if (now - hit.at >= CACHE_MS) cache.delete(id);
  return unique.flatMap((id) => {
    const v = cache.get(id)?.value;
    return v ? [v] : [];
  });
}

/** A strong validator for an answer: the hash of its JSON. */
export const etagOf = (body: unknown): string =>
  `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 27)}"`;

/** Whether an If-None-Match header names this ETag (a list, or `*`; weak forms compare by their value). */
export function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v === etag || v === `W/${etag}`;
  });
}
