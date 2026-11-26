// Profiles and follows (spec 025). People get a profile on first use; institutions are created by staff or the demo seed and
// run by their administrators. Following is one row per follower and profile; a new follow notifies the profile's owners.
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { follows, profileAdmins, profiles } from "../db/schema";
import { ApiError } from "../http/errors";
import { notify, ownersOf } from "./notifications";
import { canonicalHandle, handleProblem, profileIdByHandle } from "./handles";
import { administered, ensurePersonProfile, type Executor } from "./person-profile";
import { postsByProfile, type PostDto } from "./posts";

export const SUGGESTION_LIMIT = 6;

export interface ProfileDto {
  id: string;
  kind: "person" | "institution";
  name: string;
  /** Spec 057. */
  handle: string;
  bio: string;
  followers: number;
  following: number;
  viewerFollows: boolean;
  isOwn: boolean;
  canManage: boolean;
}

export interface MeDto extends ProfileDto {
  administers: { id: string; name: string }[];
}

const kindOf = (k: string): ProfileDto["kind"] => (k === "institution" ? "institution" : "person");

async function profileDto(db: Executor, viewer: number, profileId: string): Promise<ProfileDto | null> {
  const [p] = await db
    .select({
      id: profiles.id,
      kind: profiles.kind,
      userId: profiles.userId,
      name: profiles.name,
      handle: profiles.handle,
      bio: profiles.bio,
      followers: sql<number>`(select count(*)::int from ${follows} where ${follows.profileId} = ${profiles.id})`,
      following: sql<number>`(case when ${profiles.userId} is null then 0 else (select count(*)::int from ${follows} where ${follows.followerUserId} = ${profiles.userId}) end)`,
      viewerFollows: sql<boolean>`exists (select 1 from ${follows} where ${follows.profileId} = ${profiles.id} and ${follows.followerUserId} = ${viewer})`,
      admin: sql<boolean>`exists (select 1 from ${profileAdmins} where ${profileAdmins.profileId} = ${profiles.id} and ${profileAdmins.userId} = ${viewer})`,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId));
  if (!p) return null;
  const isOwn = p.userId === viewer;
  return {
    id: p.id,
    kind: kindOf(p.kind),
    name: p.name,
    handle: p.handle,
    bio: p.bio,
    followers: Number(p.followers),
    following: Number(p.following),
    viewerFollows: Boolean(p.viewerFollows),
    isOwn,
    canManage: isOwn || Boolean(p.admin),
  };
}

export async function getMe(identity: Identity, db: Db = getDb()): Promise<MeDto> {
  const own = await ensurePersonProfile(db, identity);
  const dto = await profileDto(db, identity.userId, own.id);
  return { ...dto!, administers: await administered(db, identity.userId) };
}

export async function updateMe(
  identity: Identity,
  input: { name?: string; bio?: string; handle?: string },
  db: Db = getDb(),
): Promise<MeDto> {
  const own = await ensurePersonProfile(db, identity);
  // Only these fields are written, whatever else a body holds.
  const set: Partial<{ name: string; bio: string; handle: string }> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.bio !== undefined) set.bio = input.bio;
  if (input.handle !== undefined) {
    const handle = canonicalHandle(input.handle);
    if (handleProblem(handle)) throw new ApiError(400, "profile.handle_invalid");
    const holder = await profileIdByHandle(db, handle);
    if (holder && holder !== own.id) throw new ApiError(409, "profile.handle_taken");
    set.handle = handle;
  }
  if (Object.keys(set).length) {
    try {
      await db
        .update(profiles)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(profiles.id, own.id));
    } catch (e) {
      // Taken between the check and the write: the unique index decides.
      if (set.handle && /unique|23505/i.test(`${(e as { code?: string }).code ?? ""} ${String(e)}`))
        throw new ApiError(409, "profile.handle_taken");
      throw e;
    }
  }
  return getMe(identity, db);
}

/** Spec 057: the profile with this handle. */
export async function getProfileByHandle(identity: Identity, handle: string, db: Db = getDb()): Promise<ProfileDto> {
  const id = await profileIdByHandle(db, handle);
  const dto = id ? await profileDto(db, identity.userId, id) : null;
  if (!dto) throw new ApiError(404, "profile.not_found");
  return dto;
}

export async function getProfile(
  identity: Identity,
  profileId: string,
  db: Db = getDb(),
): Promise<{ profile: ProfileDto; posts: PostDto[] }> {
  const profile = await profileDto(db, identity.userId, profileId);
  if (!profile) throw new ApiError(404, "profile.not_found");
  return { profile, posts: await postsByProfile(identity, profileId, db) };
}

async function followerCount(db: Executor, profileId: string): Promise<number> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(eq(follows.profileId, profileId));
  return c?.n ?? 0;
}

export async function follow(identity: Identity, profileId: string, db: Db = getDb()) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.id, profileId));
    if (!target) throw new ApiError(404, "profile.not_found");
    if (target.userId === identity.userId) throw new ApiError(400, "follow.self");
    const own = await ensurePersonProfile(tx, identity);
    const inserted = await tx
      .insert(follows)
      .values({ followerUserId: identity.userId, profileId })
      .onConflictDoNothing()
      .returning({ profileId: follows.profileId });
    if (inserted.length)
      await notify(tx, {
        recipients: await ownersOf(tx, profileId),
        kind: "follow",
        actorProfileId: own.id,
        actorUserId: identity.userId,
      });
    return { following: true, followers: await followerCount(tx, profileId) };
  });
}

export async function unfollow(identity: Identity, profileId: string, db: Db = getDb()) {
  const [target] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId));
  if (!target) throw new ApiError(404, "profile.not_found");
  await db.delete(follows).where(and(eq(follows.followerUserId, identity.userId), eq(follows.profileId, profileId)));
  return { following: false, followers: await followerCount(db, profileId) };
}

export async function suggested(identity: Identity, db: Db = getDb()): Promise<ProfileDto[]> {
  const followed = db.select({ id: follows.profileId }).from(follows).where(eq(follows.followerUserId, identity.userId));
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(notInArray(profiles.id, followed), sql`(${profiles.userId} is null or ${profiles.userId} <> ${identity.userId})`))
    .orderBy(
      sql`case when ${profiles.kind} = 'institution' then 0 else 1 end`,
      desc(sql`(select count(*) from ${follows} where ${follows.profileId} = ${profiles.id})`),
      profiles.name,
    )
    .limit(SUGGESTION_LIMIT);
  const out: ProfileDto[] = [];
  for (const r of rows) {
    const dto = await profileDto(db, identity.userId, r.id);
    if (dto) out.push(dto);
  }
  return out;
}
