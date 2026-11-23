// The release's view of the reader's manifest (packages/host-contract/pinned/surface-manifest.v1.ts): parse it with the pinned
// schema, list its files, and rewrite it for the stable pointer.
import { surfaceManifestSchema, type SurfaceManifest } from "@sefaria-social/host-contract";

export const MANIFEST = "manifest.json";
/** The SurfaceHost majors the reader serves today (reader seam: SERVED_MAJORS). */
export const SERVED_MAJORS = [1];

export const versionPrefix = (version: string) => `v/${version}/`;
export const STABLE_MANIFEST = "stable/manifest.json";
export const STABLE_STATE = "stable/state.json";

export function parseManifest(text: string, where: string): SurfaceManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${where} is not JSON`);
  }
  const parsed = surfaceManifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${where} does not match the reader's manifest schema: ${parsed.error.message}`);
  return parsed.data;
}

/** Every file the manifest makes the reader load: the entry first, then each chunk and stylesheet. */
export function manifestFiles(m: SurfaceManifest): { path: string; integrity: string }[] {
  return [{ path: m.entry, integrity: m.integrity }, ...m.files];
}

/** True for a path relative to the manifest (what the release publishes); absolute URLs are someone else's files. */
export const isRelative = (p: string) => !/^https?:\/\//.test(p) && !p.startsWith("../") && !p.startsWith("/");

/**
 * The stable pointer's manifest: the same entries, each path pointing into the version's folder relative to
 * stable/manifest.json. The reader resolves paths against the manifest's URL, so it preloads exactly the URLs the entry's own
 * imports resolve to, and the integrity hashes still apply.
 */
export function pointerManifest(m: SurfaceManifest, version: string): SurfaceManifest {
  const to = (p: string) => `../${versionPrefix(version)}${p.replace(/^\.\//, "")}`;
  return {
    ...m,
    entry: to(m.entry),
    files: m.files.map((f) => ({ path: to(f.path), integrity: f.integrity })),
    ...(m.css ? { css: m.css.map(to) } : {}),
  };
}
