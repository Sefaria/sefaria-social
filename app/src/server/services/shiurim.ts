// Shiurim (spec 063; Sefaria-Project LINKED_PANELS_AND_ASSETS_PLAN.md 6.1, D5, D8, D9): the shiur is the parent of its
// recordings and its Claude assets, each asset pinned at the version it was given with, so a recording replays with that
// version after the author saves a newer one. `teacher_user_id` is the owner (decision 0015 point 2). Unlisted (the default)
// and public shiurim open for anyone with the link; private ones only in their owner's list.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { assetVersions, assets, profiles, sessionRecordings, shiurAssets, shiurim, userDisplay } from "../db/schema";
import { ApiError } from "../http/errors";
import { contentUrl, shiurContentUrl } from "./asset-content";
import type { StoredManifest } from "./claude-assets";
import { ensurePersonProfile, type Executor } from "./person-profile";

export type Visibility = "private" | "unlisted" | "public";

export interface ShiurDto {
  id: string;
  title: string;
  visibility: Visibility;
  owner: { name: string; profileId: string | null };
  recordings: { id: string; title: string | null; startedAt: string; durationMs: number | null }[];
  assets: {
    assetId: string;
    versionId: string;
    n: number;
    title: string;
    description: string;
    refs: string[];
    firstRef: string;
    position: number;
    contentUrl: string;
    shiurUrl: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

const visibilityOf = (v: string): Visibility => (v === "public" || v === "unlisted" ? v : "private");

async function shiurDto(db: Executor, s: typeof shiurim.$inferSelect): Promise<ShiurDto> {
  const [p] = await db
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .where(and(eq(profiles.userId, s.teacherUserId), eq(profiles.kind, "person")));
  const [d] = p
    ? []
    : await db.select({ name: userDisplay.name }).from(userDisplay).where(eq(userDisplay.userId, s.teacherUserId));
  const recordings = await db
    .select({
      id: sessionRecordings.id,
      title: sessionRecordings.title,
      startedAt: sessionRecordings.startedAt,
      durationMs: sessionRecordings.durationMs,
    })
    .from(sessionRecordings)
    .where(and(eq(sessionRecordings.shiurId, s.id), eq(sessionRecordings.status, "ready")))
    .orderBy(asc(sessionRecordings.startedAt));
  const pinned = await db
    .select({ pin: shiurAssets, n: assetVersions.n, manifest: assetVersions.manifest })
    .from(shiurAssets)
    .innerJoin(assets, and(eq(assets.id, shiurAssets.assetId), eq(assets.hidden, false)))
    .innerJoin(assetVersions, eq(assetVersions.id, shiurAssets.versionId))
    .where(eq(shiurAssets.shiurId, s.id))
    .orderBy(asc(shiurAssets.position));
  return {
    id: s.id,
    title: s.title,
    visibility: visibilityOf(s.visibility),
    owner: { name: p?.name ?? d?.name ?? "Sefaria learner", profileId: p?.id ?? null },
    recordings: recordings.map((r) => ({
      id: r.id,
      title: r.title,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.durationMs,
    })),
    assets: pinned.map(({ pin, n, manifest }) => {
      const m = manifest as StoredManifest;
      return {
        assetId: pin.assetId,
        versionId: pin.versionId,
        n,
        title: m.title,
        description: m.description,
        refs: m.refs.map((r) => r.ref),
        firstRef: m.refs[0]?.ref ?? "",
        position: pin.position,
        contentUrl: contentUrl(pin.versionId),
        shiurUrl: shiurContentUrl(s.id, pin.versionId),
      };
    }),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Create a shiur the caller owns, optionally with one of their recordings (spec 063 AC-001). */
export async function createShiur(
  identity: Identity,
  input: { title: string; visibility?: Visibility; recordingId?: string },
  db: Db = getDb(),
): Promise<ShiurDto> {
  return db.transaction(async (tx) => {
    if (input.recordingId) {
      const [own] = await tx
        .select({ id: sessionRecordings.id })
        .from(sessionRecordings)
        .where(and(eq(sessionRecordings.id, input.recordingId), eq(sessionRecordings.ownerUserId, identity.userId)));
      if (!own) throw new ApiError(404, "recording.not_found");
    }
    await ensurePersonProfile(tx, identity);
    const [s] = await tx
      .insert(shiurim)
      .values({ teacherUserId: identity.userId, title: input.title, visibility: input.visibility ?? "unlisted" })
      .returning();
    if (input.recordingId)
      await tx.update(sessionRecordings).set({ shiurId: s!.id }).where(eq(sessionRecordings.id, input.recordingId));
    return shiurDto(tx, s!);
  });
}

/** The caller's own shiurim, newest first. */
export async function listMyShiurim(identity: Identity, db: Db = getDb()): Promise<{ shiurim: ShiurDto[] }> {
  const rows = await db
    .select()
    .from(shiurim)
    .where(eq(shiurim.teacherUserId, identity.userId))
    .orderBy(desc(shiurim.createdAt))
    .limit(200);
  const out: ShiurDto[] = [];
  for (const s of rows) out.push(await shiurDto(db, s));
  return { shiurim: out };
}

/** An unlisted or public shiur for anyone (spec 063 AC-002); private or unknown is 404. */
export async function getShiur(shiurId: string, db: Db = getDb()): Promise<ShiurDto> {
  const [s] = await db
    .select()
    .from(shiurim)
    .where(and(eq(shiurim.id, shiurId), inArray(shiurim.visibility, ["unlisted", "public"])));
  if (!s) throw new ApiError(404, "shiur.not_found");
  return shiurDto(db, s);
}

async function ownShiur(db: Executor, identity: Identity, shiurId: string) {
  const [s] = await db
    .select()
    .from(shiurim)
    .where(and(eq(shiurim.id, shiurId), eq(shiurim.teacherUserId, identity.userId)));
  if (!s) throw new ApiError(404, "shiur.not_found");
  return s;
}

/**
 * Pin a version in the caller's shiur, or move its pin (spec 063 AC-003): the caller's own asset (any version, the current one
 * by default) or a published, not hidden one (its published version only).
 */
export async function pinAsset(
  identity: Identity,
  shiurId: string,
  input: { assetId: string; versionId?: string },
  db: Db = getDb(),
): Promise<ShiurDto> {
  return db.transaction(async (tx) => {
    const s = await ownShiur(tx, identity, shiurId);
    const [a] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.id, input.assetId), eq(assets.hidden, false)));
    const own = a?.ownerUserId === identity.userId;
    const target = input.versionId ?? (own ? a?.currentVersionId : a?.publishedVersionId);
    if (!a || !target || (!own && target !== a.publishedVersionId)) throw new ApiError(404, "asset.not_found");
    const [v] = await tx
      .select({ id: assetVersions.id })
      .from(assetVersions)
      .where(and(eq(assetVersions.id, target), eq(assetVersions.assetId, a.id)));
    if (!v) throw new ApiError(404, "asset.not_found");
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${shiurAssets.position}) + 1, 0)::int` })
      .from(shiurAssets)
      .where(eq(shiurAssets.shiurId, s.id));
    await tx
      .insert(shiurAssets)
      .values({ shiurId: s.id, assetId: a.id, versionId: v.id, position: Number(next) })
      .onConflictDoUpdate({ target: [shiurAssets.shiurId, shiurAssets.assetId], set: { versionId: v.id } });
    const [updated] = await tx
      .update(shiurim)
      .set({ updatedAt: sql`now()` })
      .where(eq(shiurim.id, s.id))
      .returning();
    return shiurDto(tx, updated!);
  });
}

/** Remove an asset from the caller's shiur. */
export async function unpinAsset(identity: Identity, shiurId: string, assetId: string, db: Db = getDb()): Promise<ShiurDto> {
  return db.transaction(async (tx) => {
    const s = await ownShiur(tx, identity, shiurId);
    const gone = await tx
      .delete(shiurAssets)
      .where(and(eq(shiurAssets.shiurId, s.id), eq(shiurAssets.assetId, assetId)))
      .returning({ id: shiurAssets.assetId });
    if (!gone.length) throw new ApiError(404, "asset.not_found");
    const [updated] = await tx
      .update(shiurim)
      .set({ updatedAt: sql`now()` })
      .where(eq(shiurim.id, s.id))
      .returning();
    return shiurDto(tx, updated!);
  });
}
