// Loads the built surface the way the reader does (reader seam notes, "How the reader loads the surface"): fetch the manifest,
// validate it with the pinned schema, link every stylesheet and modulepreload every script with its integrity hash, wait for
// them, import the entry and check its default export. A difference from the reader here would hide a release problem.
// Like the reader (PUBLIC_SOCIAL_ORIGINS), every resolved URL must be on an allowed origin, over https except on localhost.
import { surfaceManifestSchema, type Surface } from "@sefaria-social/host-contract";

const load = (el: HTMLLinkElement) =>
  new Promise<void>((resolve, reject) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error(`failed to load ${el.href}`)), { once: true });
  });

function link(rel: string, href: string, integrity: string): HTMLLinkElement {
  const el = document.createElement("link");
  el.rel = rel;
  el.href = href;
  el.integrity = integrity;
  el.crossOrigin = "anonymous";
  el.dataset.surface = "social";
  return el;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The reader's origin rule: on the allowlist, and https unless the host is local. Throws otherwise. */
export function checkOrigin(url: string, allowedOrigins: readonly string[]): string {
  const u = new URL(url);
  if (!allowedOrigins.includes(u.origin)) throw new Error(`${u.origin} is not an allowed surface origin`);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname))) throw new Error(`${url} is not https`);
  return u.href;
}

export async function loadSurface(
  manifestUrl: string,
  allowedOrigins: readonly string[] = [location.origin],
): Promise<{ surface: Surface; version: string }> {
  const absolute = checkOrigin(new URL(manifestUrl, location.href).href, allowedOrigins);
  const res = await fetch(absolute, { credentials: "omit", cache: "no-cache", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const manifest = surfaceManifestSchema.parse(await res.json());
  if (manifest.contract !== 1) throw new Error(`manifest: contract ${manifest.contract} is not served`);
  const resolve = (p: string) => checkOrigin(new URL(p, res.url).href, allowedOrigins);
  const integrityOf = new Map(manifest.files.map((f) => [f.path, f.integrity]));
  const els: HTMLLinkElement[] = [];
  for (const css of manifest.css ?? []) els.push(link("stylesheet", resolve(css), integrityOf.get(css) ?? ""));
  const entry = link("modulepreload", resolve(manifest.entry), manifest.integrity);
  els.push(entry);
  for (const f of manifest.files) if (!f.path.endsWith(".css")) els.push(link("modulepreload", resolve(f.path), f.integrity));
  const waits = els.filter((el) => el === entry || el.rel === "stylesheet").map(load);
  document.head.append(...els);
  await Promise.all(waits);
  const mod = (await import(/* @vite-ignore */ entry.href)) as { default?: Partial<Surface> };
  const s = mod.default;
  if (!s || s.id !== "social" || s.contract !== 1 || typeof s.mountPage !== "function" || typeof s.mountPersistent !== "function")
    throw new Error("the entry's default export is not a SurfaceHost v1 Surface");
  return { surface: s as Surface, version: manifest.version };
}
