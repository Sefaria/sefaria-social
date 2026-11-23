// Posts, the timeline, replies and reactions (specs 023 and 024). A post is written as a profile: the author's own person
// profile, or an institution they administer. Deleting a post marks it deleted (it disappears everywhere); a reply is removed.
// The timeline is time-ordered with a keyset cursor (created time, id), 20 posts a page.
import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { follows, posts, profileAdmins, profiles, reactions, replies } from "../db/schema";
import { ApiError } from "../http/errors";
import { notify, notifyFollowersOfPost, ownersOf } from "./notifications";
import { canActAs, ensurePersonProfile } from "./person-profile";

export const PAGE_SIZE = 20;

export interface AuthorDto {
  id: string;
  kind: "person" | "institution";
  name: string;
}

export interface PostDto {
  id: string;
  body: string;
  ref: string | null;
  author: AuthorDto;
  createdAt: string;
  replyCount: number;
  reactionCount: number;
  reacted: boolean;
  canDelete: boolean;
}

export interface ReplyDto {
  id: string;
  body: string;
  author: AuthorDto;
  createdAt: string;
  canDelete: boolean;
}

export type TimelineTab = "following" | "everyone";

const kindOf = (k: string): AuthorDto["kind"] => (k === "institution" ? "institution" : "person");

function postColumns(viewer: number) {
  return {
    id: posts.id,
    body: posts.body,
    ref: posts.ref,
    createdAt: posts.createdAt,
    authorId: profiles.id,
    authorKind: profiles.kind,
    authorName: profiles.name,
    replyCount: sql<number>`(select count(*)::int from ${replies} where ${replies.postId} = ${posts.id})`,
    reactionCount: sql<number>`(select count(*)::int from ${reactions} where ${reactions.postId} = ${posts.id})`,
    reacted: sql<boolean>`exists (select 1 from ${reactions} where ${reactions.postId} = ${posts.id} and ${reactions.userId} = ${viewer})`,
    canDelete: sql<boolean>`(${posts.createdByUserId} = ${viewer} or ${profiles.userId} = ${viewer} or exists (select 1 from ${profileAdmins} where ${profileAdmins.profileId} = ${profiles.id} and ${profileAdmins.userId} = ${viewer}))`,
  };
}

type PostRow = {
  id: string;
  body: string;
  ref: string | null;
  createdAt: Date;
  authorId: string;
  authorKind: string;
  authorName: string;
  replyCount: number;
  reactionCount: number;
  reacted: boolean;
  canDelete: boolean;
};

const toPost = (r: PostRow): PostDto => ({
  id: r.id,
  body: r.body,
  ref: r.ref,
  author: { id: r.authorId, kind: kindOf(r.authorKind), name: r.authorName },
  createdAt: r.createdAt.toISOString(),
  replyCount: Number(r.replyCount),
  reactionCount: Number(r.reactionCount),
  reacted: Boolean(r.reacted),
  canDelete: Boolean(r.canDelete),
});

async function selectPosts(db: Db, viewer: number, where: SQL | undefined, limit: number): Promise<PostDto[]> {
  const rows = await db
    .select(postColumns(viewer))
    .from(posts)
    .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
    .where(and(isNull(posts.deletedAt), where))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit);
  return rows.map(toPost);
}

// ── Cursor ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function encodeCursor(p: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([p.createdAt, p.id])).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(v) || typeof v[0] !== "string" || typeof v[1] !== "string") return null;
    const createdAt = new Date(v[0]);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(v[1])) return null;
    return { createdAt, id: v[1] };
  } catch {
    return null;
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function createPost(
  identity: Identity,
  input: { body: string; ref?: string | null; asProfileId?: string | null },
  db: Db = getDb(),
): Promise<PostDto> {
  const id = await db.transaction(async (tx) => {
    const own = await ensurePersonProfile(tx, identity);
    const authorProfileId = input.asProfileId ?? own.id;
    if (authorProfileId !== own.id && !(await canActAs(tx, identity.userId, authorProfileId)))
      throw new ApiError(403, "post.forbidden");
    const [row] = await tx
      .insert(posts)
      .values({ authorProfileId, createdByUserId: identity.userId, body: input.body, ref: input.ref || null })
      .returning({ id: posts.id });
    await notifyFollowersOfPost(tx, authorProfileId, row!.id, identity.userId);
    return row!.id;
  });
  const [post] = await selectPosts(db, identity.userId, eq(posts.id, id), 1);
  return post!;
}

export async function timeline(
  identity: Identity,
  tab: TimelineTab,
  before: string | undefined,
  db: Db = getDb(),
): Promise<{ posts: PostDto[]; nextCursor: string | null }> {
  const viewer = identity.userId;
  const cursor = before ? decodeCursor(before) : null;
  const filters: (SQL | undefined)[] = [];
  if (tab === "following")
    filters.push(
      or(
        eq(profiles.userId, viewer),
        sql`${posts.authorProfileId} in (select ${follows.profileId} from ${follows} where ${follows.followerUserId} = ${viewer})`,
      ),
    );
  if (cursor)
    filters.push(or(lt(posts.createdAt, cursor.createdAt), and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id))));
  const page = await selectPosts(db, viewer, and(...filters), PAGE_SIZE + 1);
  const more = page.length > PAGE_SIZE;
  const shown = page.slice(0, PAGE_SIZE);
  return { posts: shown, nextCursor: more ? encodeCursor(shown.at(-1)!) : null };
}

export async function postsByProfile(identity: Identity, profileId: string, db: Db = getDb()): Promise<PostDto[]> {
  return selectPosts(db, identity.userId, eq(posts.authorProfileId, profileId), PAGE_SIZE);
}

async function livePost(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], postId: string) {
  const [p] = await db
    .select({ id: posts.id, authorProfileId: posts.authorProfileId, createdByUserId: posts.createdByUserId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  if (!p) throw new ApiError(404, "post.not_found");
  return p;
}

export async function getPost(
  identity: Identity,
  postId: string,
  db: Db = getDb(),
): Promise<{ post: PostDto; replies: ReplyDto[] }> {
  const [post] = await selectPosts(db, identity.userId, eq(posts.id, postId), 1);
  if (!post) throw new ApiError(404, "post.not_found");
  return { post, replies: await listReplies(db, identity.userId, postId) };
}

export async function deletePost(identity: Identity, postId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const p = await livePost(tx, postId);
    const allowed = p.createdByUserId === identity.userId || (await canActAs(tx, identity.userId, p.authorProfileId));
    if (!allowed) throw new ApiError(403, "post.forbidden");
    await tx
      .update(posts)
      .set({ deletedAt: sql`now()` })
      .where(eq(posts.id, postId));
  });
}

// ── Replies ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function listReplies(db: Db, viewer: number, postId: string): Promise<ReplyDto[]> {
  const rows = await db
    .select({
      id: replies.id,
      body: replies.body,
      createdAt: replies.createdAt,
      createdBy: replies.createdByUserId,
      authorId: profiles.id,
      authorKind: profiles.kind,
      authorName: profiles.name,
    })
    .from(replies)
    .innerJoin(profiles, eq(profiles.id, replies.authorProfileId))
    .where(eq(replies.postId, postId))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    author: { id: r.authorId, kind: kindOf(r.authorKind), name: r.authorName },
    createdAt: r.createdAt.toISOString(),
    canDelete: r.createdBy === viewer,
  }));
}

export async function createReply(identity: Identity, postId: string, body: string, db: Db = getDb()): Promise<ReplyDto> {
  return db.transaction(async (tx) => {
    const post = await livePost(tx, postId);
    const own = await ensurePersonProfile(tx, identity);
    const [row] = await tx
      .insert(replies)
      .values({ postId, authorProfileId: own.id, createdByUserId: identity.userId, body })
      .returning();
    await notify(tx, {
      recipients: [post.createdByUserId, ...(await ownersOf(tx, post.authorProfileId))],
      kind: "reply",
      actorProfileId: own.id,
      postId,
      actorUserId: identity.userId,
    });
    return {
      id: row!.id,
      body: row!.body,
      author: { id: own.id, kind: kindOf(own.kind), name: own.name },
      createdAt: row!.createdAt.toISOString(),
      canDelete: true,
    };
  });
}

export async function deleteReply(identity: Identity, replyId: string, db: Db = getDb()): Promise<void> {
  const [r] = await db.select({ createdBy: replies.createdByUserId }).from(replies).where(eq(replies.id, replyId));
  if (!r) throw new ApiError(404, "reply.not_found");
  if (r.createdBy !== identity.userId) throw new ApiError(403, "reply.forbidden");
  await db.delete(replies).where(eq(replies.id, replyId));
}

// ── Reactions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function reactionCount(db: Db, postId: string): Promise<number> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reactions)
    .where(eq(reactions.postId, postId));
  return c?.n ?? 0;
}

export async function react(identity: Identity, postId: string, db: Db = getDb()) {
  await db.transaction(async (tx) => {
    const post = await livePost(tx, postId);
    const inserted = await tx
      .insert(reactions)
      .values({ postId, userId: identity.userId })
      .onConflictDoNothing()
      .returning({ postId: reactions.postId });
    if (inserted.length) {
      const own = await ensurePersonProfile(tx, identity);
      await notify(tx, {
        recipients: [post.createdByUserId, ...(await ownersOf(tx, post.authorProfileId))],
        kind: "reaction",
        actorProfileId: own.id,
        postId,
        actorUserId: identity.userId,
      });
    }
  });
  return { reacted: true, reactionCount: await reactionCount(db, postId) };
}

export async function unreact(identity: Identity, postId: string, db: Db = getDb()) {
  await livePost(db, postId);
  await db.delete(reactions).where(and(eq(reactions.postId, postId), eq(reactions.userId, identity.userId)));
  return { reacted: false, reactionCount: await reactionCount(db, postId) };
}
