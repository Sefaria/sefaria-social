// Claude assets (specs 060–063; Sefaria-Project LINKED_PANELS_AND_ASSETS_PLAN.md sections 5, 6): an interactive HTML file
// made in Claude, kept by Social as immutable versions. Saving reads the manifest from the file (never from the caller), asks
// Sefaria to check and expand every ref, and stores the file in the object store under `assets/<assetId>/<sha256>.html`.
// A refused file is a 422 with problems a model can act on (decision 0015 point 5). Saves are idempotent by content hash.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { assetRefs, assetVersions, assets, profiles, shiurAssets, userDisplay } from "../db/schema";
import { ApiError } from "../http/errors";
import { log } from "../log/logger";
import { readManifest, type AssetManifest, type AssetProblem } from "../../lib/asset-manifest";
import { contentUrl } from "./asset-content";
import { fetchForImport } from "./asset-import";
import { objectStore, type ObjectStore } from "./object-store";
import { ensurePersonProfile, type Executor } from "./person-profile";
import { expandRefs, RefsUnavailable, sectionOf } from "./sefaria-refs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One declared ref as stored: Sefaria's normal form and expansion, and the ref as the file declared it. */
export interface StoredRef {
  ref: string;
  heRef: string;
  label: string | null;
  sourceRef: string;
  sectionRefs: string[];
  segmentRefs: string[];
}
export interface StoredManifest {
  v: 1;
  title: string;
  description: string;
  lang: string | null;
  refs: StoredRef[];
}

export interface VersionDto {
  id: string;
  n: number;
  sha256: string;
  bytes: number;
  createdAt: string;
  contentUrl: string;
}
export interface AuthorDto {
  name: string;
  profileId: string | null;
  verified: boolean;
}
export interface AssetDto {
  id: string;
  title: string;
  description: string;
  lang: string | null;
  sourceUrl: string | null;
  author: AuthorDto;
  currentVersionId: string | null;
  publishedVersionId: string | null;
  publishedAt: string | null;
  versions: VersionDto[];
  manifest: StoredManifest | null;
  createdAt: string;
  updatedAt: string;
}

export type SaveInput = { html: string; assetId?: string; sourceUrl?: string; dryRun?: boolean };
export type SaveResult =
  | {
      status: 201 | 200;
      body: { asset: AssetDto; version: VersionDto; created: boolean; unchanged: boolean; firstRef: string };
    }
  | { status: 200; body: { dryRun: true; manifest: StoredManifest; bytes: number; sha256: string; firstRef: string } }
  | { status: 422; body: InvalidBody };
export interface InvalidBody {
  error: { code: "asset.invalid"; message: string };
  problems: AssetProblem[];
}

export const invalid = (problems: AssetProblem[]): { status: 422; body: InvalidBody } => ({
  status: 422,
  body: {
    error: { code: "asset.invalid", message: "The asset was not saved. Fix each problem listed, then save again." },
    problems,
  },
});

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

/** Sefaria's check and expansion of every declared ref, or the problems with them. Throws 503 when Sefaria cannot be asked. */
export async function expandManifest(
  manifest: AssetManifest,
): Promise<{ ok: true; manifest: StoredManifest } | { ok: false; problems: AssetProblem[] }> {
  const declared = [...new Set(manifest.refs.map((r) => r.ref))];
  let results;
  try {
    results = await expandRefs(declared);
  } catch (e) {
    if (e instanceof RefsUnavailable) {
      log.error("asset.refs_unavailable", { error: e.message.slice(0, 200) });
      throw new ApiError(503, "asset.refs_unavailable");
    }
    throw e;
  }
  const byInput = new Map(declared.map((d, i) => [d, results[i]!]));
  const problems: AssetProblem[] = [];
  const refs: StoredRef[] = [];
  for (const r of manifest.refs) {
    const x = byInput.get(r.ref)!;
    if (!x.ok) {
      problems.push({
        code: "ref.invalid",
        ref: r.ref,
        message: `"${r.ref}" is not a ref Sefaria knows (${x.error.slice(0, 200)}). Write it in Sefaria's form, for example "Genesis 1:1-5" or "Berakhot 2a:3", then save again.`,
      });
      continue;
    }
    if (x.segmentRefs.length === 0) {
      problems.push({
        code: "ref.invalid",
        ref: r.ref,
        message: `"${r.ref}" covers no segments of text. Name a section, a segment or a range of segments.`,
      });
      continue;
    }
    refs.push({
      ref: x.ref,
      heRef: x.heRef,
      label: r.label,
      sourceRef: r.ref,
      sectionRefs: x.sectionRefs,
      segmentRefs: x.segmentRefs,
    });
  }
  if (problems.length) return { ok: false, problems };
  const segments = new Set(refs.flatMap((r) => r.segmentRefs)).size;
  const max = getConfig().ASSET_MAX_SEGMENTS;
  if (segments > max)
    return {
      ok: false,
      problems: [
        {
          code: "refs.too_broad",
          message: `The refs cover ${segments} segments; at most ${max} are allowed. Declare only the passages the asset is about.`,
        },
      ],
    };
  return {
    ok: true,
    manifest: { v: 1, title: manifest.title, description: manifest.description, lang: manifest.lang, refs },
  };
}

/** Everything that can be checked about a file without storing it. */
export async function checkFile(
  html: string,
): Promise<{ ok: true; bytes: Uint8Array; sha256: string; manifest: StoredManifest } | { ok: false; problems: AssetProblem[] }> {
  const bytes = new TextEncoder().encode(html);
  const limit = getConfig().ASSET_MAX_BYTES;
  if (bytes.byteLength > limit)
    return {
      ok: false,
      problems: [
        {
          code: "size.too_large",
          message: `The file is ${mb(bytes.byteLength)}; the limit is ${mb(limit)}. Make it smaller (fewer or smaller embedded images and media), then save again.`,
        },
      ],
    };
  const read = readManifest(html);
  if (!read.ok) return read;
  const expanded = await expandManifest(read.manifest);
  if (!expanded.ok) return expanded;
  return { ok: true, bytes, sha256: createHash("sha256").update(bytes).digest("hex"), manifest: expanded.manifest };
}

export const storageKey = (assetId: string, sha256: string) => `assets/${assetId}/${sha256}.html`;
export const assetPrefix = (assetId: string) => `assets/${assetId}/`;

const versionDto = (v: typeof assetVersions.$inferSelect): VersionDto => ({
  id: v.id,
  n: v.n,
  sha256: v.sha256,
  bytes: v.bytes,
  createdAt: iso(v.createdAt)!,
  contentUrl: contentUrl(v.id),
});

async function authorOf(db: Executor, ownerUserId: number): Promise<AuthorDto> {
  const [p] = await db
    .select({ id: profiles.id, name: profiles.name, verified: profiles.verified })
    .from(profiles)
    .where(and(eq(profiles.userId, ownerUserId), eq(profiles.kind, "person")));
  if (p) return { name: p.name, profileId: p.id, verified: p.verified };
  const [d] = await db.select({ name: userDisplay.name }).from(userDisplay).where(eq(userDisplay.userId, ownerUserId));
  return { name: d?.name || "Sefaria learner", profileId: null, verified: false };
}

/** The full answer for one asset row. */
export async function assetDto(db: Executor, a: typeof assets.$inferSelect): Promise<AssetDto> {
  const versions = await db.select().from(assetVersions).where(eq(assetVersions.assetId, a.id)).orderBy(asc(assetVersions.n));
  const current = versions.find((v) => v.id === a.currentVersionId);
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    lang: a.lang,
    sourceUrl: a.sourceUrl,
    author: await authorOf(db, a.ownerUserId),
    currentVersionId: a.currentVersionId,
    publishedVersionId: a.publishedVersionId,
    publishedAt: iso(a.publishedAt),
    versions: versions.map(versionDto),
    manifest: (current?.manifest as StoredManifest | undefined) ?? null,
    createdAt: iso(a.createdAt)!,
    updatedAt: iso(a.updatedAt)!,
  };
}

/** Save a file as a new asset, or as the next version of one of the caller's assets (spec 060 AC-001 to AC-006). */
export async function saveAsset(
  identity: Identity,
  input: SaveInput,
  db: Db = getDb(),
  store: ObjectStore = objectStore(),
): Promise<SaveResult> {
  const checked = await checkFile(input.html);
  if (!checked.ok) return invalid(checked.problems);
  const { bytes, sha256, manifest } = checked;
  const firstRef = manifest.refs[0]!.ref;
  if (input.dryRun) return { status: 200, body: { dryRun: true, manifest, bytes: bytes.byteLength, sha256, firstRef } };

  return db.transaction(async (tx) => {
    // One save at a time per user: the daily count and the insert cannot be split by a parallel save.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`claude-assets:${identity.userId}`}, 0))`);
    let asset: typeof assets.$inferSelect | undefined;
    if (input.assetId) {
      [asset] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, identity.userId)));
      if (!asset) throw new ApiError(404, "asset.not_found");
    }
    // The same bytes as a current version: answer it, store nothing (a retried save is safe).
    const [same] = await tx
      .select({ asset: assets, version: assetVersions })
      .from(assets)
      .innerJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
      .where(
        and(
          eq(assets.ownerUserId, identity.userId),
          eq(assetVersions.sha256, sha256),
          asset ? eq(assets.id, asset.id) : undefined,
        ),
      )
      .orderBy(desc(assets.updatedAt))
      .limit(1);
    if (same)
      return {
        status: 200 as const,
        body: {
          asset: await assetDto(tx, same.asset),
          version: versionDto(same.version),
          created: false,
          unchanged: true,
          firstRef,
        },
      };
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(assetVersions)
      .innerJoin(assets, eq(assets.id, assetVersions.assetId))
      .where(and(eq(assets.ownerUserId, identity.userId), gt(assetVersions.createdAt, sql`now() - interval '24 hours'`)));
    if (Number(count) >= getConfig().ASSET_DAILY_LIMIT) throw new ApiError(429, "asset.daily_limit");

    await ensurePersonProfile(tx, identity);
    const created = !asset;
    if (!asset)
      [asset] = await tx
        .insert(assets)
        .values({
          ownerUserId: identity.userId,
          title: manifest.title,
          description: manifest.description,
          lang: manifest.lang,
          sourceUrl: input.sourceUrl ?? null,
        })
        .returning();
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${assetVersions.n}), 0)::int + 1` })
      .from(assetVersions)
      .where(eq(assetVersions.assetId, asset!.id));
    const key = storageKey(asset!.id, sha256);
    await store.put(key, bytes);
    const [version] = await tx
      .insert(assetVersions)
      .values({ assetId: asset!.id, n: Number(next), sha256, storageKey: key, bytes: bytes.byteLength, manifest })
      .returning();
    const [updated] = await tx
      .update(assets)
      .set({
        currentVersionId: version!.id,
        title: manifest.title,
        description: manifest.description,
        lang: manifest.lang,
        ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(assets.id, asset!.id))
      .returning();
    return {
      status: 201 as const,
      body: { asset: await assetDto(tx, updated!), version: versionDto(version!), created, unchanged: false, firstRef },
    };
  });
}

/** An asset for anyone with its id (spec 060 AC-008); hidden or unknown is 404. */
export async function getAsset(assetId: string, db: Db = getDb()): Promise<AssetDto> {
  const [a] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.hidden, false)));
  if (!a) throw new ApiError(404, "asset.not_found");
  return assetDto(db, a);
}

/** The caller's own assets, newest first, hidden ones marked. */
export async function listMine(identity: Identity, db: Db = getDb()): Promise<{ assets: (AssetDto & { hidden: boolean })[] }> {
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.ownerUserId, identity.userId))
    .orderBy(desc(assets.updatedAt))
    .limit(200);
  const out = [];
  for (const a of rows) out.push({ ...(await assetDto(db, a)), hidden: a.hidden });
  return { assets: out };
}

/** Delete one of the caller's assets, its versions and its files (spec 060 AC-009). */
export async function deleteAsset(
  identity: Identity,
  assetId: string,
  db: Db = getDb(),
  store: ObjectStore = objectStore(),
): Promise<void> {
  const gone = await db
    .delete(assets)
    .where(and(eq(assets.id, assetId), eq(assets.ownerUserId, identity.userId)))
    .returning({ id: assets.id });
  if (!gone.length) throw new ApiError(404, "asset.not_found");
  await store.removePrefix(assetPrefix(assetId));
}

/** Remove the files of assets whose rows are gone (after a user's deletion). Returns how many assets' files were removed. */
export async function sweepOrphanAssets(db: Db = getDb(), store: ObjectStore = objectStore()): Promise<number> {
  const keys = await store.list("assets/");
  const ids = [...new Set(keys.map((k) => k.split("/")[1]).filter((id): id is string => !!id && UUID.test(id)))];
  let removed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const kept = new Set((await db.select({ id: assets.id }).from(assets).where(inArray(assets.id, batch))).map((r) => r.id));
    for (const id of batch.filter((x) => !kept.has(x))) {
      await store.removePrefix(assetPrefix(id));
      removed++;
    }
  }
  return removed;
}

// ── Content (spec 061) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A version's file, if its asset exists and is not hidden; 404 otherwise. */
export async function contentOf(versionId: string, db: Db = getDb(), store: ObjectStore = objectStore()): Promise<Uint8Array> {
  const [row] = await db
    .select({ key: assetVersions.storageKey })
    .from(assetVersions)
    .innerJoin(assets, eq(assets.id, assetVersions.assetId))
    .where(and(eq(assetVersions.id, versionId), eq(assets.hidden, false)));
  const bytes = row ? await store.get(row.key) : null;
  if (!bytes) throw new ApiError(404, "asset.not_found");
  return bytes;
}

/** Whether this shiur pins this version now (spec 063). */
export async function pinnedIn(shiurId: string, versionId: string, db: Db = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ ok: sql<number>`1` })
    .from(shiurAssets)
    .where(and(eq(shiurAssets.shiurId, shiurId), eq(shiurAssets.versionId, versionId)))
    .limit(1);
  return row !== undefined;
}

// ── Publishing and the ref read API (spec 062) ────────────────────────────────────────────────────────────────────────────

async function ownedAsset(db: Executor, identity: Identity, assetId: string) {
  const [a] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.ownerUserId, identity.userId)));
  if (!a) throw new ApiError(404, "asset.not_found");
  return a;
}

/** Publish a version (the current one by default): only a verified owner (spec 062 AC-002). */
export async function publish(
  identity: Identity,
  assetId: string,
  versionId: string | undefined,
  db: Db = getDb(),
): Promise<AssetDto> {
  return db.transaction(async (tx) => {
    const a = await ownedAsset(tx, identity, assetId);
    const target = versionId ?? a.currentVersionId;
    const [v] = target
      ? await tx
          .select()
          .from(assetVersions)
          .where(and(eq(assetVersions.id, target), eq(assetVersions.assetId, a.id)))
      : [];
    if (!v) throw new ApiError(404, "asset.not_found");
    const author = await authorOf(tx, identity.userId);
    if (!author.verified) throw new ApiError(403, "asset.not_verified");
    const manifest = v.manifest as StoredManifest;
    const rows: (typeof assetRefs.$inferInsert)[] = [];
    const seen = new Set<string>();
    for (const r of manifest.refs)
      for (const segment of r.segmentRefs) {
        if (seen.has(segment)) continue;
        seen.add(segment);
        rows.push({
          assetId: a.id,
          versionId: v.id,
          segmentRef: segment,
          sectionRef: sectionOf(segment, r.sectionRefs),
          sourceRef: r.ref,
          label: r.label,
          position: rows.length,
        });
      }
    await tx.delete(assetRefs).where(eq(assetRefs.assetId, a.id));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(assetRefs).values(rows.slice(i, i + 500));
    const [updated] = await tx
      .update(assets)
      .set({ publishedVersionId: v.id, publishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(assets.id, a.id))
      .returning();
    return assetDto(tx, updated!);
  });
}

/** Unpublish (spec 062 AC-003): no published version, no indexed rows. */
export async function unpublish(identity: Identity, assetId: string, db: Db = getDb()): Promise<AssetDto> {
  return db.transaction(async (tx) => {
    const a = await ownedAsset(tx, identity, assetId);
    await tx.delete(assetRefs).where(eq(assetRefs.assetId, a.id));
    const [updated] = await tx
      .update(assets)
      .set({ publishedVersionId: null, publishedAt: null, updatedAt: sql`now()` })
      .where(eq(assets.id, a.id))
      .returning();
    return assetDto(tx, updated!);
  });
}

export interface RefAssetDto {
  id: string;
  title: string;
  description: string;
  author: { name: string; profileId: string; verified: true };
  anchorRefs: string[];
  refs: string[];
  versionId: string;
  contentUrl: string;
}

export const REF_LIMIT = 50;

/**
 * The sidebar's read (spec 062 AC-004): published, not hidden assets of verified authors covering a segment of `ref` (a section
 * or a segment in Sefaria's normal form), newest published first, each with the covered segments inside `ref` in text order.
 */
export async function assetsForRef(ref: string, db: Db = getDb()): Promise<{ ref: string; assets: RefAssetDto[] }> {
  const rows = await db
    .select({
      assetId: assets.id,
      title: assets.title,
      description: assets.description,
      versionId: assets.publishedVersionId,
      publishedAt: assets.publishedAt,
      manifest: assetVersions.manifest,
      profileId: profiles.id,
      name: profiles.name,
      segment: assetRefs.segmentRef,
      position: assetRefs.position,
    })
    .from(assetRefs)
    .innerJoin(assets, and(eq(assets.id, assetRefs.assetId), eq(assets.publishedVersionId, assetRefs.versionId)))
    .innerJoin(assetVersions, eq(assetVersions.id, assetRefs.versionId))
    .innerJoin(profiles, and(eq(profiles.userId, assets.ownerUserId), eq(profiles.kind, "person"), eq(profiles.verified, true)))
    .where(
      and(
        eq(assets.hidden, false),
        isNotNull(assets.publishedVersionId),
        or(eq(assetRefs.segmentRef, ref), eq(assetRefs.sectionRef, ref)),
      ),
    )
    .orderBy(desc(assets.publishedAt), asc(assets.id), asc(assetRefs.position));
  const byAsset = new Map<string, RefAssetDto>();
  for (const r of rows) {
    let dto = byAsset.get(r.assetId);
    if (!dto) {
      if (byAsset.size >= REF_LIMIT) continue;
      dto = {
        id: r.assetId,
        title: r.title,
        description: r.description,
        author: { name: r.name, profileId: r.profileId, verified: true },
        anchorRefs: [],
        refs: (r.manifest as StoredManifest).refs.map((x) => x.ref),
        versionId: r.versionId!,
        contentUrl: contentUrl(r.versionId!),
      };
      byAsset.set(r.assetId, dto);
    }
    dto.anchorRefs.push(r.segment);
  }
  return { ref, assets: [...byAsset.values()] };
}

// ── Profiles (spec 063) ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PublicAssetDto {
  id: string;
  title: string;
  description: string;
  refs: string[];
  versionId: string;
  contentUrl: string;
  publishedAt: string;
}

/** A person's published, not hidden assets, newest first (spec 063 AC-005). Unknown profile: 404. */
export async function publicAssetsOf(profileId: string, db: Db = getDb()): Promise<{ assets: PublicAssetDto[] }> {
  const [p] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.id, profileId));
  if (!p) throw new ApiError(404, "profile.not_found");
  if (p.userId === null) return { assets: [] };
  const rows = await db
    .select({ asset: assets, manifest: assetVersions.manifest })
    .from(assets)
    .innerJoin(assetVersions, eq(assetVersions.id, assets.publishedVersionId))
    .where(and(eq(assets.ownerUserId, p.userId), eq(assets.hidden, false)))
    .orderBy(desc(assets.publishedAt))
    .limit(100);
  return {
    assets: rows.map(({ asset, manifest }) => ({
      id: asset.id,
      title: asset.title,
      description: asset.description,
      refs: (manifest as StoredManifest).refs.map((r) => r.ref),
      versionId: asset.publishedVersionId!,
      contentUrl: contentUrl(asset.publishedVersionId!),
      publishedAt: iso(asset.publishedAt)!,
    })),
  };
}

// ── Import (spec 060 AC-007) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Fetch a public https URL once and save it like an upload, keeping the URL as `sourceUrl`. */
export async function importAsset(
  identity: Identity,
  input: { url: string; assetId?: string; dryRun?: boolean },
  db: Db = getDb(),
): Promise<SaveResult> {
  const got = await fetchForImport(input.url, getConfig().ASSET_MAX_BYTES);
  if (!got.ok) {
    log.info("asset.import_refused", { code: got.problem.code });
    return invalid([got.problem]);
  }
  return saveAsset(identity, { html: got.html, assetId: input.assetId, sourceUrl: got.url.href, dryRun: input.dryRun }, db);
}
