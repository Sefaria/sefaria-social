// Staff tools for Claude assets (spec 062), run from the command line with the server's DATABASE_URL (having it is what makes
// them staff-only, like purge-user; decision 0015 point 9): verify a person's profile (the blue check needed to publish to the
// sidebar) or remove the mark, and take an asset down or restore it. No web request can do either.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { assets, profiles } from "../db/schema";
import { profileIdByHandle } from "./handles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A profile id, or an @handle. Null when it names no profile. */
export async function resolveProfile(db: Db, ref: string): Promise<string | null> {
  if (UUID.test(ref)) {
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, ref.toLowerCase()));
    return p?.id ?? null;
  }
  if (ref.startsWith("@")) return profileIdByHandle(db, ref.slice(1));
  return null;
}

/** Mark a person's profile verified (with when and by whom) or remove the mark. Null when it is not a person's profile. */
export async function setVerified(
  db: Db,
  profileRef: string,
  on: boolean,
  by: string,
): Promise<{ id: string; name: string; verified: boolean } | null> {
  const id = await resolveProfile(db, profileRef);
  if (!id) return null;
  const [row] = await db
    .update(profiles)
    .set(
      on
        ? { verified: true, verifiedAt: sql`now()`, verifiedBy: by, updatedAt: sql`now()` }
        : { verified: false, verifiedAt: null, verifiedBy: null, updatedAt: sql`now()` },
    )
    .where(and(eq(profiles.id, id), eq(profiles.kind, "person")))
    .returning({ id: profiles.id, name: profiles.name, verified: profiles.verified });
  return row ?? null;
}

/** Hide an asset (staff takedown) or restore it. Null when there is no such asset. */
export async function setHidden(
  db: Db,
  assetId: string,
  on: boolean,
): Promise<{ id: string; title: string; hidden: boolean } | null> {
  if (!UUID.test(assetId)) return null;
  const [row] = await db
    .update(assets)
    .set({ hidden: on, hiddenAt: on ? sql`now()` : null })
    .where(eq(assets.id, assetId.toLowerCase()))
    .returning({ id: assets.id, title: assets.title, hidden: assets.hidden });
  return row ?? null;
}
