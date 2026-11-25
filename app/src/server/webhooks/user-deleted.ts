// Django's account-deletion webhook (plan section 6.3; contract in Sefaria-Project sso/user_deleted_webhook.py). The wrapper
// has already verified the signature over the raw body. Idempotent on the event id: the receipt, the deletion and the
// tombstone commit together, so a retry after a crash either finds nothing done or everything done. After the commit (never
// inside the transaction: no I/O there), the relay is told to drop the user from their rooms; a failure there is logged and
// does not undo the deletion (the relay also refuses nobody else, and the user's tokens expire within 10 minutes). Then
// LiveKit removes them from every live call (spec 038), with the same rule: logged, never undone.
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { webhookReceipts } from "../db/schema";
import { ApiError } from "../http/errors";
import { log } from "../log/logger";
import { dropUserFromRelay } from "../services/relay";
import { liveCallRoomIds } from "../services/calls";
import { removeFromLiveCalls } from "../services/livekit";
import { deleteUserData, roomIdsOf } from "../services/users";
import { sweepOrphanObjects } from "../services/recordings";

export interface WebhookEvent {
  event: string;
  id: string;
  occurred_at: string;
  user_id?: number | undefined;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

export async function receiveUserDeleted(
  event: WebhookEvent,
  eventIdHeader: string | null,
  db: Db = getDb(),
): Promise<WebhookOutcome> {
  if (eventIdHeader !== null && eventIdHeader !== event.id) throw new ApiError(400, "request.invalid");
  const userId = event.user_id;
  if (event.event === "user.deleted" && userId === undefined) throw new ApiError(400, "request.invalid");
  const outcome = await db.transaction(async (tx) => {
    const fresh = await tx
      .insert(webhookReceipts)
      .values({ eventId: event.id, eventType: event.event.slice(0, 100) })
      .onConflictDoNothing()
      .returning({ eventId: webhookReceipts.eventId });
    if (fresh.length === 0) {
      log.info("webhook.user_deleted.duplicate");
      return "duplicate";
    }
    if (event.event !== "user.deleted" || userId === undefined) {
      log.info("webhook.ignored");
      return "ignored";
    }
    const rooms = await roomIdsOf(tx, userId);
    const calls = await liveCallRoomIds(tx); // before the user's own rooms (and their call status) are deleted
    const counts = await deleteUserData(tx, userId, event.id);
    log.info("webhook.user_deleted.processed", { ...counts });
    return { kind: "processed" as const, userId, rooms, calls };
  });
  if (typeof outcome === "string") return outcome;
  await dropUserFromRelay(outcome.userId, outcome.rooms);
  await removeFromLiveCalls(outcome.userId, outcome.calls); // spec 038: out of every live call too
  await sweepOrphanObjects(); // spec 051: the media of the user's recordings, whose rows just went
  return outcome.kind;
}
