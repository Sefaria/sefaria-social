// Room calls as LiveKit reports them (spec 038). LiveKit's signed webhooks (verified in http/endpoint.ts) keep one call_status
// row per room, so cards and the lobby can say "N on a call" without opening a socket. Idempotent on the event id through
// webhook_receipts, in one transaction with the status change. Holds no user ids.
import { eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { LivekitEventBody } from "../api/contracts";
import { getDb, type Db } from "../db/client";
import { callStatus, rooms, webhookReceipts } from "../db/schema";
import { log } from "../log/logger";

export interface CallStatusDto {
  live: boolean;
  participants: number;
}

export const NO_CALL: CallStatusDto = { live: false, participants: 0 };

export type LivekitEvent = z.infer<typeof LivekitEventBody>;

const ROOM_NAME = /^room_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const COUNTED = new Set(["room_started", "participant_joined", "participant_left"]);

export async function receiveLivekitEvent(e: LivekitEvent, db: Db = getDb()): Promise<"processed" | "duplicate" | "ignored"> {
  return db.transaction(async (tx) => {
    const fresh = await tx
      .insert(webhookReceipts)
      .values({ eventId: e.id, eventType: `livekit.${e.event}`.slice(0, 100) })
      .onConflictDoNothing()
      .returning({ eventId: webhookReceipts.eventId });
    if (fresh.length === 0) return "duplicate";
    const roomId = ROOM_NAME.exec(e.room?.name ?? "")?.[1];
    if (!roomId || (!COUNTED.has(e.event) && e.event !== "room_finished")) {
      log.info("webhook.ignored");
      return "ignored";
    }
    const [exists] = await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).limit(1);
    if (!exists) {
      log.info("webhook.ignored");
      return "ignored";
    }
    const participants = e.event === "room_finished" ? 0 : Math.max(0, e.room?.numParticipants ?? 0);
    const live = participants > 0;
    await tx
      .insert(callStatus)
      .values({ roomId, live, participants, startedAt: live ? sql`now()` : null })
      .onConflictDoUpdate({
        target: callStatus.roomId,
        set: {
          live,
          participants,
          // when a call starts (from not live), now; while it lasts, kept; when it ends, cleared
          startedAt: live ? sql`case when ${callStatus.live} then ${callStatus.startedAt} else now() end` : null,
          updatedAt: sql`now()`,
        },
      });
    return "processed";
  });
}

/** The call status of these rooms (a room with no row has no call). */
export async function callStatusOf(roomIds: readonly string[], db: Db = getDb()): Promise<Map<string, CallStatusDto>> {
  const out = new Map<string, CallStatusDto>();
  if (roomIds.length === 0) return out;
  const rows = await db
    .select({ roomId: callStatus.roomId, live: callStatus.live, participants: callStatus.participants })
    .from(callStatus)
    .where(inArray(callStatus.roomId, [...roomIds]));
  for (const r of rows) out.set(r.roomId, { live: r.live, participants: r.participants });
  return out;
}
