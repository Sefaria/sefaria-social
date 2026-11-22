// Django's account-deletion webhook (plan section 6.3; contract in Sefaria-Project sso/user_deleted_webhook.py). The wrapper
// has already verified the signature over the raw body. Idempotent on the event id: the receipt, the deletion and the
// tombstone commit together, so a retry after a crash either finds nothing done or everything done.
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { webhookReceipts } from "../db/schema";
import { ApiError } from "../http/errors";
import { log } from "../log/logger";
import { deleteUserData } from "../services/users";

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
  return db.transaction(async (tx) => {
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
    const counts = await deleteUserData(tx, userId, event.id);
    log.info("webhook.user_deleted.processed", { ...counts });
    return "processed";
  });
}
