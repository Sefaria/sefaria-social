// Posts, the timeline, replies and reactions (specs 023 and 024), reposts and quotes (spec 030), the ranked "For you" tab and
// reply order (spec 031). A post is written as a profile: the author's own person profile, or an institution they administer.
// Deleting a post marks it deleted (it disappears everywhere; a quote of it shows it as unavailable); a reply is removed.
// Following is time-ordered, posts and reposts together, with a keyset cursor (time, entry key), 20 a page. For you is ranked
// (services/ranking.ts) with an offset cursor pinned to the time the first page was ranked.
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import {
  broadcasts,
  follows,
  posts,
  profileAdmins,
  profiles,
  reactions,
  replies,
  reposts,
  roomMembers,
  rooms,
  sessionRecordings,
  userDisplay,
} from "../db/schema";
import { ApiError } from "../http/errors";
import { notify, notifyFollowersOfPost, ownersOf } from "./notifications";
import { canActAs, ensurePersonProfile } from "./person-profile";
import { rank, type Candidate } from "./ranking";

export const PAGE_SIZE = 20;

export interface AuthorDto {
  id: string;
  kind: "person" | "institution";
  name: string;
}

/** The post a quote quotes; body, ref, author and time are null when it was deleted. */
export interface QuotedPostDto {
  id: string;
  body: string | null;
  ref: string | null;
  author: AuthorDto | null;
  createdAt: string | null;
}

export type EmbedKind = "room" | "broadcast" | "recording";

/** A post's card (spec 055); title and leader are null when the target no longer exists. */
export interface EmbedDto {
  kind: EmbedKind;
  id: string;
  title: string | null;
  leader: string | null;
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
  repostCount: number;
  quoteCount: number;
  reposted: boolean;
  quoted: QuotedPostDto | null;
  /** In a timeline: the profile (one the viewer follows, or the viewer) whose repost brought this post here. */
  repostedBy: AuthorDto | null;
  /** Only on a post that embeds a room, broadcast or recording (spec 055); absent otherwise. */
  embed?: EmbedDto;
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
    quotedPostId: posts.quotedPostId,
    repostCount: sql<number>`(select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.id})`,
    quoteCount: sql<number>`(select count(*)::int from posts q where q.quoted_post_id = ${posts.id} and q.deleted_at is null)`,
    reposted: sql<boolean>`exists (select 1 from ${reposts} r join profiles rp on rp.id = r.profile_id where r.post_id = ${posts.id} and rp.user_id = ${viewer})`,
    embedKind: posts.embedKind,
    embedId: posts.embedId,
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
  quotedPostId: string | null;
  repostCount: number;
  quoteCount: number;
  reposted: boolean;
  embedKind: string | null;
  embedId: string | null;
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
  repostCount: Number(r.repostCount),
  quoteCount: Number(r.quoteCount),
  reposted: Boolean(r.reposted),
  quoted: r.quotedPostId ? { id: r.quotedPostId, body: null, ref: null, author: null, createdAt: null } : null,
  repostedBy: null,
  ...(r.embedKind && r.embedId ? { embed: { kind: r.embedKind as EmbedKind, id: r.embedId, title: null, leader: null } } : {}),
});

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Title and leader's name of each embedded target of one kind (spec 055); a missing target is left out. */
async function embedTargets(
  db: Tx,
  kind: EmbedKind,
  ids: string[],
): Promise<Map<string, { title: string; leader: string | null }>> {
  if (!ids.length) return new Map();
  const rows =
    kind === "room"
      ? await db
          .select({ id: rooms.id, title: rooms.title, leader: userDisplay.name })
          .from(rooms)
          .leftJoin(userDisplay, eq(userDisplay.userId, rooms.ownerUserId))
          .where(inArray(rooms.id, ids))
      : kind === "broadcast"
        ? await db
            .select({ id: broadcasts.id, title: broadcasts.title, leader: userDisplay.name })
            .from(broadcasts)
            .leftJoin(userDisplay, eq(userDisplay.userId, broadcasts.hostUserId))
            .where(inArray(broadcasts.id, ids))
        : await db
            .select({
              id: sessionRecordings.id,
              title: sql<string>`coalesce(${sessionRecordings.title}, ${rooms.title})`,
              leader: userDisplay.name,
            })
            .from(sessionRecordings)
            .innerJoin(rooms, eq(rooms.id, sessionRecordings.roomId))
            .leftJoin(userDisplay, eq(userDisplay.userId, sessionRecordings.ownerUserId))
            .where(inArray(sessionRecordings.id, ids));
  return new Map(rows.map((r) => [r.id, { title: r.title, leader: r.leader ?? null }]));
}

/**
 * Whether this user may post a card for the target (spec 055 AC-002): it exists and they are in its room (owner or member).
 * A room is members-only; posting it makes its title and live text public (decision 0011 D9), so only its people may.
 */
async function mayEmbed(db: Tx, userId: number, kind: EmbedKind, id: string): Promise<boolean> {
  const roomOf =
    kind === "room"
      ? sql`${id}::uuid`
      : kind === "broadcast"
        ? sql`(select ${broadcasts.roomId} from ${broadcasts} where ${broadcasts.id} = ${id}::uuid)`
        : sql`(select ${sessionRecordings.roomId} from ${sessionRecordings} where ${sessionRecordings.id} = ${id}::uuid)`;
  const [row] = await db
    .select({ ok: sql<number>`1` })
    .from(roomMembers)
    .where(and(eq(roomMembers.userId, userId), sql`${roomMembers.roomId} = ${roomOf}`))
    .limit(1);
  return row !== undefined;
}

/** Fill in each embed's title and leader (one query per kind present). */
async function withEmbeds(db: Db, list: PostDto[]): Promise<PostDto[]> {
  const kinds: EmbedKind[] = ["room", "broadcast", "recording"];
  const found = new Map<string, { title: string; leader: string | null }>();
  for (const kind of kinds) {
    const ids = [...new Set(list.flatMap((p) => (p.embed?.kind === kind ? [p.embed.id] : [])))];
    for (const [id, t] of await embedTargets(db, kind, ids)) found.set(`${kind}:${id}`, t);
  }
  return list.map((p) => {
    const t = p.embed && found.get(`${p.embed.kind}:${p.embed.id}`);
    return t && p.embed ? { ...p, embed: { ...p.embed, ...t } } : p;
  });
}

/** Fill in the posts that these posts quote (one query; a deleted one stays as its id). */
async function withQuoted(db: Db, list: PostDto[]): Promise<PostDto[]> {
  const ids = [...new Set(list.flatMap((p) => (p.quoted ? [p.quoted.id] : [])))];
  if (!ids.length) return list;
  const rows = await db
    .select({
      id: posts.id,
      body: posts.body,
      ref: posts.ref,
      createdAt: posts.createdAt,
      authorId: profiles.id,
      authorKind: profiles.kind,
      authorName: profiles.name,
    })
    .from(posts)
    .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
    .where(and(inArray(posts.id, ids), isNull(posts.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((p) => {
    const q = p.quoted && byId.get(p.quoted.id);
    if (!q) return p;
    return {
      ...p,
      quoted: {
        id: q.id,
        body: q.body,
        ref: q.ref,
        createdAt: q.createdAt.toISOString(),
        author: { id: q.authorId, kind: kindOf(q.authorKind), name: q.authorName },
      },
    };
  });
}

async function selectPosts(db: Db, viewer: number, where: SQL | undefined, limit: number): Promise<PostDto[]> {
  const rows = await db
    .select(postColumns(viewer))
    .from(posts)
    .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
    .where(and(isNull(posts.deletedAt), where))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit);
  return withEmbeds(db, await withQuoted(db, rows.map(toPost)));
}

/** These posts, in this order (missing or deleted ones left out). */
async function postsInOrder(db: Db, viewer: number, ids: string[]): Promise<PostDto[]> {
  if (!ids.length) return [];
  const found = await selectPosts(db, viewer, inArray(posts.id, ids), ids.length);
  const byId = new Map(found.map((p) => [p.id, p]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

async function authorsById(db: Db, ids: string[]): Promise<Map<string, AuthorDto>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: profiles.id, kind: profiles.kind, name: profiles.name })
    .from(profiles)
    .where(inArray(profiles.id, ids));
  return new Map(rows.map((r) => [r.id, { id: r.id, kind: kindOf(r.kind), name: r.name }]));
}

// ── Cursors ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Following: [time, entry key], the key "p:<post>" for a post or "r:<post>:<profile>" for a repost (a bare post id, from
// before spec 030, reads as "p:<id>"). For you: ["rank", offset, time the first page was ranked].
const UUID = "[0-9a-f-]{36}";
const ENTRY_KEY = new RegExp(`^(?:p:${UUID}|r:${UUID}:${UUID})$`);

export function encodeCursor(p: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([p.createdAt, p.id])).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(v) || typeof v[0] !== "string" || typeof v[1] !== "string") return null;
    const createdAt = new Date(v[0]);
    if (Number.isNaN(createdAt.getTime())) return null;
    const key = new RegExp(`^${UUID}$`).test(v[1]) ? `p:${v[1]}` : v[1];
    if (!ENTRY_KEY.test(key)) return null;
    return { createdAt, id: key };
  } catch {
    return null;
  }
}

export function encodeRankCursor(offset: number, asOf: Date): string {
  return Buffer.from(JSON.stringify(["rank", offset, asOf.toISOString()])).toString("base64url");
}

export function decodeRankCursor(cursor: string): { offset: number; asOf: Date } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v[0] !== "rank" || !Number.isSafeInteger(v[1]) || (v[1] as number) < 0 || typeof v[2] !== "string")
      return null;
    const asOf = new Date(v[2]);
    return Number.isNaN(asOf.getTime()) ? null : { offset: v[1] as number, asOf };
  } catch {
    return null;
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function createPost(
  identity: Identity,
  input: {
    body: string;
    ref?: string | null;
    asProfileId?: string | null;
    quotedPostId?: string | null;
    embed?: { kind: EmbedKind; id: string };
  },
  db: Db = getDb(),
): Promise<PostDto> {
  const id = await db.transaction(async (tx) => {
    const own = await ensurePersonProfile(tx, identity);
    const authorProfileId = input.asProfileId ?? own.id;
    if (authorProfileId !== own.id && !(await canActAs(tx, identity.userId, authorProfileId)))
      throw new ApiError(403, "post.forbidden");
    if (input.quotedPostId) await livePost(tx, input.quotedPostId);
    if (
      input.embed &&
      (!(await embedTargets(tx, input.embed.kind, [input.embed.id])).size ||
        !(await mayEmbed(tx, identity.userId, input.embed.kind, input.embed.id)))
    )
      throw new ApiError(404, "embed.not_found");
    const [row] = await tx
      .insert(posts)
      .values({
        authorProfileId,
        createdByUserId: identity.userId,
        body: input.body,
        ref: input.ref || null,
        quotedPostId: input.quotedPostId || null,
        embedKind: input.embed?.kind ?? null,
        embedId: input.embed?.id ?? null,
      })
      .returning({ id: posts.id });
    await notifyFollowersOfPost(tx, authorProfileId, row!.id, identity.userId);
    return row!.id;
  });
  const [post] = await selectPosts(db, identity.userId, eq(posts.id, id), 1);
  return post!;
}

/** The profiles in the viewer's network: the ones they follow and their own person profile. */
const network = (viewer: number) =>
  sql`(select ${follows.profileId} from ${follows} where ${follows.followerUserId} = ${viewer} union select ${profiles.id} from ${profiles} where ${profiles.userId} = ${viewer})`;

export async function timeline(
  identity: Identity,
  tab: TimelineTab,
  before: string | undefined,
  db: Db = getDb(),
): Promise<{ posts: PostDto[]; nextCursor: string | null }> {
  return tab === "everyone" ? forYou(identity, before, db) : following(identity, before, db);
}

/** Following: the network's posts and reposts, newest first; a post shows once, at its latest entry. */
async function following(identity: Identity, before: string | undefined, db: Db) {
  const viewer = identity.userId;
  const cursor = before ? decodeCursor(before) : null;
  const postKey = sql`('p:' || ${posts.id}::text)`;
  const repostKey = sql`('r:' || ${reposts.postId}::text || ':' || ${reposts.profileId}::text)`;
  const beforeCursor = (at: typeof posts.createdAt | typeof reposts.createdAt, key: SQL) =>
    cursor ? or(lt(at, cursor.createdAt), and(eq(at, cursor.createdAt), sql`${key} < ${cursor.id}`)) : undefined;
  const authored = await db
    .select({ postId: posts.id, at: posts.createdAt, key: sql<string>`${postKey}` })
    .from(posts)
    .where(
      and(isNull(posts.deletedAt), sql`${posts.authorProfileId} in ${network(viewer)}`, beforeCursor(posts.createdAt, postKey)),
    )
    .orderBy(desc(posts.createdAt), desc(postKey))
    .limit(PAGE_SIZE + 1);
  const shared = await db
    .select({ postId: reposts.postId, at: reposts.createdAt, key: sql<string>`${repostKey}`, by: reposts.profileId })
    .from(reposts)
    .innerJoin(posts, eq(posts.id, reposts.postId))
    .where(
      and(isNull(posts.deletedAt), sql`${reposts.profileId} in ${network(viewer)}`, beforeCursor(reposts.createdAt, repostKey)),
    )
    .orderBy(desc(reposts.createdAt), desc(repostKey))
    .limit(PAGE_SIZE + 1);
  const entries = [...authored.map((e) => ({ ...e, by: null as string | null })), ...shared]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .slice(0, PAGE_SIZE + 1);
  const more = entries.length > PAGE_SIZE;
  const page = entries.slice(0, PAGE_SIZE);
  const seen = new Set<string>();
  const unique = page.filter((e) => !seen.has(e.postId) && seen.add(e.postId));
  const [list, by] = await Promise.all([
    postsInOrder(
      db,
      viewer,
      unique.map((e) => e.postId),
    ),
    authorsById(db, [...new Set(unique.flatMap((e) => (e.by ? [e.by] : [])))]),
  ]);
  const byPost = new Map(unique.map((e) => [e.postId, e.by]));
  const last = page.at(-1);
  return {
    posts: list.map((p) => ({ ...p, repostedBy: (byPost.get(p.id) && by.get(byPost.get(p.id)!)) || null })),
    nextCursor: more && last ? encodeCursor({ createdAt: last.at.toISOString(), id: last.key }) : null,
  };
}

/** At most this many recent posts are ranked for one viewer. */
export const RANK_CANDIDATES = 500;
/** Posts (or reposts) newer than this many days are candidates. */
export const RANK_WINDOW_DAYS = 14;

/** For you: every recent post, ranked for this viewer (services/ranking.ts). */
async function forYou(identity: Identity, before: string | undefined, db: Db) {
  const viewer = identity.userId;
  const cursor = before ? decodeRankCursor(before) : null;
  const offset = cursor?.offset ?? 0;
  const asOf = cursor?.asOf ?? new Date();
  const candidates = await rankCandidates(db, viewer, asOf);
  const ranked = rank(
    candidates.map((c) => c.candidate),
    asOf,
  );
  const page = ranked.slice(offset, offset + PAGE_SIZE);
  const via = new Map(candidates.map((c) => [c.candidate.postId, c.viaProfileId]));
  const [list, by] = await Promise.all([
    postsInOrder(
      db,
      viewer,
      page.map((s) => s.postId),
    ),
    authorsById(db, [...new Set(page.flatMap((s) => (via.get(s.postId) ? [via.get(s.postId)!] : [])))]),
  ]);
  return {
    posts: list.map((p) => {
      const v = via.get(p.id);
      return { ...p, repostedBy: v ? (by.get(v) ?? null) : null };
    }),
    nextCursor: offset + PAGE_SIZE < ranked.length ? encodeRankCursor(offset + PAGE_SIZE, asOf) : null,
  };
}

type CandidateRow = {
  id: string;
  author: string;
  created_at: Date | string;
  fav: number;
  reply: number;
  repost: number;
  quote: number;
  reply_by_author: number;
  audience: number;
  boosted_at: Date | string | null;
  in_network: boolean;
  via_profile: string | null;
  affinity: number;
};

/** Sources and hydration: the recent posts and, for each, what the ranker needs to know for this viewer. */
export async function rankCandidates(
  db: Db,
  viewer: number,
  asOf: Date,
): Promise<{ candidate: Candidate; viaProfileId: string | null }[]> {
  const at = asOf.toISOString();
  const result = await db.execute(sql`
    with net as (
      select profile_id from follows where follower_user_id = ${viewer}
      union select id from profiles where user_id = ${viewer}
    ),
    cand as (
      select p.id, p.author_profile_id, p.created_at from posts p
      where p.deleted_at is null and p.created_at <= ${at}::timestamptz
        and (p.created_at > ${at}::timestamptz - make_interval(days => ${RANK_WINDOW_DAYS})
             or exists (select 1 from reposts r where r.post_id = p.id and r.created_at > ${at}::timestamptz - make_interval(days => ${RANK_WINDOW_DAYS})))
      order by p.created_at desc limit ${RANK_CANDIDATES}
    )
    select c.id, c.author_profile_id as author, c.created_at,
      (select count(*)::int from reactions x where x.post_id = c.id) as fav,
      (select count(*)::int from replies x where x.post_id = c.id) as reply,
      (select count(*)::int from reposts x where x.post_id = c.id) as repost,
      (select count(*)::int from posts q where q.quoted_post_id = c.id and q.deleted_at is null) as quote,
      (select count(*)::int from replies x where x.post_id = c.id and x.author_profile_id = c.author_profile_id) as reply_by_author,
      (select count(*)::int from follows f where f.profile_id = c.author_profile_id) as audience,
      greatest(
        (select max(x.created_at) from reposts x where x.post_id = c.id),
        (select max(q.created_at) from posts q where q.quoted_post_id = c.id and q.deleted_at is null)
      ) as boosted_at,
      c.author_profile_id in (select profile_id from net) as in_network,
      (select r.profile_id from reposts r where r.post_id = c.id and r.profile_id in (select profile_id from net)
        and r.profile_id <> c.author_profile_id order by r.created_at desc limit 1) as via_profile,
      (
        (select count(*) from reactions x join posts pp on pp.id = x.post_id
          where x.user_id = ${viewer} and pp.author_profile_id = c.author_profile_id and x.created_at > ${at}::timestamptz - interval '30 days')
        + (select count(*) from replies x join posts pp on pp.id = x.post_id
          where x.created_by_user_id = ${viewer} and pp.author_profile_id = c.author_profile_id and x.created_at > ${at}::timestamptz - interval '30 days')
        + (select count(*) from reposts x join posts pp on pp.id = x.post_id
          where x.created_by_user_id = ${viewer} and pp.author_profile_id = c.author_profile_id and x.created_at > ${at}::timestamptz - interval '30 days')
        + (select count(*) from posts q join posts pp on pp.id = q.quoted_post_id
          where q.created_by_user_id = ${viewer} and q.deleted_at is null and pp.author_profile_id = c.author_profile_id and q.created_at > ${at}::timestamptz - interval '30 days')
      )::int as affinity
    from cand c
    order by c.created_at desc, c.id desc
  `);
  const rows = ((result as unknown as { rows?: CandidateRow[] }).rows ?? (result as unknown as CandidateRow[])) as CandidateRow[];
  return rows.map((r) => ({
    viaProfileId: r.via_profile,
    candidate: {
      postId: r.id,
      authorProfileId: r.author,
      createdAt: new Date(r.created_at),
      boostedAt: r.boosted_at ? new Date(r.boosted_at) : null,
      counts: {
        fav: Number(r.fav),
        reply: Number(r.reply),
        repost: Number(r.repost),
        quote: Number(r.quote),
        replyEngagedByAuthor: Number(r.reply_by_author),
        negativeFeedback: 0,
        report: 0,
      },
      audience: Number(r.audience),
      inNetwork: Boolean(r.in_network),
      viaNetworkRepost: r.via_profile !== null,
      affinity: Number(r.affinity),
    },
  }));
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
    // conversation order (spec 031): the post's author's own replies first (X weights a reply the author engages with
    // highest), then replies from profiles the viewer follows, then everyone else; oldest first within each
    .orderBy(
      sql`case when ${replies.authorProfileId} = (select p.author_profile_id from posts p where p.id = ${postId}) then 0
        when ${replies.authorProfileId} in (select ${follows.profileId} from ${follows} where ${follows.followerUserId} = ${viewer}) then 1
        else 2 end`,
      asc(replies.createdAt),
      asc(replies.id),
    );
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

// ── Reposts (spec 030) ────────────────────────────────────────────────────────────────────────────────────────────────────
async function repostCount(db: Db, postId: string): Promise<number> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reposts)
    .where(eq(reposts.postId, postId));
  return c?.n ?? 0;
}

/** Repost as the viewer's own profile (idempotent). */
export async function repost(identity: Identity, postId: string, db: Db = getDb()) {
  await db.transaction(async (tx) => {
    await livePost(tx, postId);
    const own = await ensurePersonProfile(tx, identity);
    await tx.insert(reposts).values({ postId, profileId: own.id, createdByUserId: identity.userId }).onConflictDoNothing();
  });
  return { reposted: true, repostCount: await repostCount(db, postId) };
}

export async function unrepost(identity: Identity, postId: string, db: Db = getDb()) {
  await livePost(db, postId);
  const own = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, identity.userId));
  if (own[0]) await db.delete(reposts).where(and(eq(reposts.postId, postId), eq(reposts.profileId, own[0].id)));
  return { reposted: false, repostCount: await repostCount(db, postId) };
}
