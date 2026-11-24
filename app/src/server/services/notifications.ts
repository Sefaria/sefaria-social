// Notifications (spec 026): written in the same transaction as the action that causes them, read by the recipient, never
// about one's own action. In-app only.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { follows, notifications, posts, profileAdmins, profiles } from "../db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export type NotificationKind = "follow" | "reply" | "reaction" | "post";
export const NOTIFICATION_LIMIT = 50;
const SNIPPET = 120;

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  actor: { id: string; name: string } | null;
  post: { id: string; snippet: string } | null;
  createdAt: string;
  read: boolean;
}

/** The people who hear about a profile: its person, or every administrator of an institution. */
export async function ownersOf(db: Executor, profileId: string): Promise<number[]> {
  const [p] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.id, profileId));
  if (!p) return [];
  if (p.userId !== null) return [p.userId];
  const admins = await db
    .select({ userId: profileAdmins.userId })
    .from(profileAdmins)
    .where(eq(profileAdmins.profileId, profileId));
  return admins.map((a) => a.userId);
}

export async function notify(
  db: Executor,
  input: { recipients: number[]; kind: NotificationKind; actorProfileId: string; postId?: string | null; actorUserId: number },
): Promise<void> {
  const recipients = [...new Set(input.recipients)].filter((r) => r !== input.actorUserId);
  if (recipients.length === 0) return;
  await db.insert(notifications).values(
    recipients.map((recipientUserId) => ({
      recipientUserId,
      kind: input.kind,
      actorProfileId: input.actorProfileId,
      postId: input.postId ?? null,
    })),
  );
}

/** A new post tells the author profile's followers. */
export async function notifyFollowersOfPost(db: Executor, authorProfileId: string, postId: string, actorUserId: number) {
  const rows = await db.select({ userId: follows.followerUserId }).from(follows).where(eq(follows.profileId, authorProfileId));
  await notify(db, { recipients: rows.map((r) => r.userId), kind: "post", actorProfileId: authorProfileId, postId, actorUserId });
}

export async function listNotifications(
  identity: Identity,
  db: Db = getDb(),
): Promise<{ notifications: NotificationDto[]; unread: number }> {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      actorId: profiles.id,
      actorName: profiles.name,
      postId: posts.id,
      postBody: posts.body,
      postDeleted: posts.deletedAt,
    })
    .from(notifications)
    .leftJoin(profiles, eq(profiles.id, notifications.actorProfileId))
    .leftJoin(posts, eq(posts.id, notifications.postId))
    .where(eq(notifications.recipientUserId, identity.userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_LIMIT);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, identity.userId), isNull(notifications.readAt)));
  return {
    notifications: rows
      .filter((r) => !(r.postId && r.postDeleted))
      .map((r) => ({
        id: r.id,
        kind: r.kind as NotificationKind,
        actor: r.actorId ? { id: r.actorId, name: r.actorName ?? "" } : null,
        post: r.postId ? { id: r.postId, snippet: snippet(r.postBody ?? "") } : null,
        createdAt: r.createdAt.toISOString(),
        read: r.readAt !== null,
      })),
    unread: count?.n ?? 0,
  };
}

export async function markAllRead(identity: Identity, db: Db = getDb()): Promise<{ unread: number }> {
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.recipientUserId, identity.userId), isNull(notifications.readAt)));
  return { unread: 0 };
}

const snippet = (body: string) => (body.length > SNIPPET ? `${body.slice(0, SNIPPET - 1).trimEnd()}…` : body);
