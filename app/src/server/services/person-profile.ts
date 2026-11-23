// The caller's person profile (spec 025): one per Sefaria user, created on first use with the token's name. Shared by the
// posts and profiles services so neither imports the other.
import { eq } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import type { Db } from "../db/client";
import { profileAdmins, profiles } from "../db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface ProfileRow {
  id: string;
  kind: string;
  userId: number | null;
  name: string;
  bio: string;
}

const FALLBACK_NAME = "Sefaria learner";

export async function ensurePersonProfile(db: Executor, identity: Identity): Promise<ProfileRow> {
  const [existing] = await db.select().from(profiles).where(eq(profiles.userId, identity.userId));
  if (existing) return existing;
  const [created] = await db
    .insert(profiles)
    .values({ kind: "person", userId: identity.userId, name: identity.name || FALLBACK_NAME })
    .onConflictDoNothing({ target: profiles.userId })
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(profiles).where(eq(profiles.userId, identity.userId));
  return raced!;
}

/** The institution profiles the user administers. */
export async function administered(db: Executor, userId: number): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: profiles.id, name: profiles.name })
    .from(profileAdmins)
    .innerJoin(profiles, eq(profiles.id, profileAdmins.profileId))
    .where(eq(profileAdmins.userId, userId))
    .orderBy(profiles.name);
}

/** May this user act as this profile (their own person profile, or an institution they administer)? */
export async function canActAs(db: Executor, userId: number, profileId: string): Promise<boolean> {
  const [p] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.id, profileId));
  if (!p) return false;
  if (p.userId === userId) return true;
  const admins = await administered(db, userId);
  return admins.some((a) => a.id === profileId);
}
