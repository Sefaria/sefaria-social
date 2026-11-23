// User data held by social, keyed by the Sefaria user id: the display cache, and the deletion that removes every row for a
// user (plan section 6.3). deleteUserData is the one function the webhook and the staff purge command share; when a table
// gains a user column, extend it here and the seed in test/integration/schema-walk.ts (the walk test fails until you do).
import { eq, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import type { Db } from "../db/client";
import { deletedUsers, roomMembers, rooms, shiurim, shiurRecordings, userDisplay } from "../db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** Refresh the display cache from the token's claims (on writes that link the user to something). */
export async function upsertDisplay(db: Executor, identity: Identity): Promise<void> {
  await db
    .insert(userDisplay)
    .values({ userId: identity.userId, name: identity.name, img: identity.picture })
    .onConflictDoUpdate({
      target: userDisplay.userId,
      set: { name: identity.name, img: identity.picture, updatedAt: sql`now()` },
    });
}

export interface DeletionCounts {
  room_members: number;
  shiur_recordings: number;
  shiurim: number;
  rooms: number;
  user_display: number;
}

/** The rooms a user is a member of (owned ones included), for telling the relay after a deletion commits. */
export async function roomIdsOf(tx: Executor, userId: number): Promise<string[]> {
  const rows = await tx.select({ id: roomMembers.roomId }).from(roomMembers).where(eq(roomMembers.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * Delete every row for `userId` and write its tombstone. Run inside the caller's transaction. Set-based statements in a
 * fixed order; cascades remove other members of the user's rooms and recordings of the user's shiurim.
 */
export async function deleteUserData(tx: Executor, userId: number, eventId: string | null): Promise<DeletionCounts> {
  const memberships = await tx.delete(roomMembers).where(eq(roomMembers.userId, userId)).returning({ id: roomMembers.roomId });
  const recordings = await tx
    .delete(shiurRecordings)
    .where(eq(shiurRecordings.ownerUserId, userId))
    .returning({ id: shiurRecordings.id });
  const taught = await tx.delete(shiurim).where(eq(shiurim.teacherUserId, userId)).returning({ id: shiurim.id });
  const owned = await tx.delete(rooms).where(eq(rooms.ownerUserId, userId)).returning({ id: rooms.id });
  const display = await tx.delete(userDisplay).where(eq(userDisplay.userId, userId)).returning({ id: userDisplay.userId });
  await tx.insert(deletedUsers).values({ userId, eventId }).onConflictDoNothing();
  return {
    room_members: memberships.length,
    shiur_recordings: recordings.length,
    shiurim: taught.length,
    rooms: owned.length,
    user_display: display.length,
  };
}
