// `release publish` (spec 020 AC-001): upload one surface build under v/<version>/, immutably.
//  1. Read the build's manifest.json and validate it with the reader's pinned schema.
//  2. Check every listed file against its integrity hash (a build altered after the fact is refused before any upload).
//  3. Refuse if the version already holds a different file at any path (versions are immutable; publish a new version).
//  4. Upload the files, then the manifest last: a version without a manifest is "not published", so a half-finished upload
//     can never be promoted.
// Source maps are never uploaded: only the files the manifest lists, and the manifest.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchesIntegrity } from "./integrity";
import { MANIFEST, isRelative, manifestFiles, parseManifest, versionPrefix } from "./manifest";
import { IMMUTABLE, contentTypeOf, type StorageTarget } from "./storage";

export interface PublishResult {
  version: string;
  uploaded: string[];
  unchanged: string[];
}

export async function publish(target: StorageTarget, buildDir: string, opts: { version?: string } = {}): Promise<PublishResult> {
  const manifestText = await readFile(path.join(buildDir, MANIFEST), "utf8").catch(() => {
    throw new Error(`${path.join(buildDir, MANIFEST)} is missing. Fix: run 'npm run build:surface' first.`);
  });
  const manifest = parseManifest(manifestText, `${buildDir}/${MANIFEST}`);
  const version = manifest.version;
  if (opts.version && opts.version !== version)
    throw new Error(
      `the build is version ${version}, not ${opts.version}. Fix: build with SURFACE_VERSION=${opts.version} npm run build:surface.`,
    );

  const objects: { key: string; body: Buffer }[] = [];
  for (const f of manifestFiles(manifest)) {
    if (!isRelative(f.path))
      throw new Error(`${f.path}: a release manifest lists files relative to itself; the release uploads only those.`);
    const body = await readFile(path.join(buildDir, f.path)).catch(() => {
      throw new Error(`${f.path} is listed in the manifest but missing from ${buildDir}.`);
    });
    if (!matchesIntegrity(body, f.integrity))
      throw new Error(
        `${f.path} does not match its integrity hash in the manifest; the build was altered after it was made. Fix: rebuild.`,
      );
    objects.push({ key: `${versionPrefix(version)}${f.path.replace(/^\.\//, "")}`, body });
  }
  objects.push({ key: `${versionPrefix(version)}${MANIFEST}`, body: Buffer.from(manifestText) });

  const uploaded: string[] = [];
  const unchanged: string[] = [];
  const todo: typeof objects = [];
  for (const o of objects) {
    const existing = await target.get(o.key);
    if (!existing) todo.push(o);
    else if (existing.body.equals(o.body)) unchanged.push(o.key);
    else
      throw new Error(
        `${o.key} already exists with different content. Published versions are immutable. Fix: build and publish a new version (SURFACE_VERSION).`,
      );
  }
  // The manifest is last in `objects`, so it is uploaded last.
  for (const o of todo) {
    await target.put(o.key, o.body, { contentType: contentTypeOf(o.key), cacheControl: IMMUTABLE });
    uploaded.push(o.key);
  }
  return { version, uploaded, unchanged };
}
