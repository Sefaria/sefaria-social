// Smoke tests (spec 020 AC-002; release.yml). A version is good when what the reader would fetch is what was built:
//  - smokeVersion: read back through the storage target (before the pointer moves).
//  - smokeUrl: over HTTP, as the reader does: the manifest and every file, with an Origin header, checking CORS and SRI.
//  - smokeServer: the deployed server answers health and refuses protected routes without a token.
import { matchesIntegrity } from "./integrity";
import { MANIFEST, SERVED_MAJORS, manifestFiles, parseManifest, versionPrefix } from "./manifest";
import type { StorageTarget } from "./storage";

const EXPECTED_TYPE: Record<string, RegExp> = { ".js": /javascript/, ".css": /text\/css/ };
const typeProblem = (p: string, contentType: string | null) => {
  const ext = p.match(/\.[a-z]+$/)?.[0] ?? "";
  const want = EXPECTED_TYPE[ext];
  return want && !want.test(contentType ?? "") ? `${p} is served as "${contentType}", not ${want.source}` : null;
};

/** Problems with a published version, read through the target; [] when it is good. */
export async function smokeVersion(target: StorageTarget, version: string): Promise<string[]> {
  const key = `${versionPrefix(version)}${MANIFEST}`;
  const obj = await target.get(key);
  if (!obj) return [`version ${version} is not published (${key} is missing)`];
  let manifest;
  try {
    manifest = parseManifest(obj.body.toString("utf8"), key);
  } catch (e) {
    return [(e as Error).message];
  }
  if (manifest.version !== version) return [`${key} says version ${manifest.version}`];
  const problems: string[] = [];
  if (!SERVED_MAJORS.includes(manifest.contract))
    problems.push(`contract major ${manifest.contract} is not served by the reader (${SERVED_MAJORS.join(", ")})`);
  for (const f of manifestFiles(manifest)) {
    const file = await target.get(`${versionPrefix(version)}${f.path.replace(/^\.\//, "")}`);
    if (!file) problems.push(`${f.path} is missing`);
    else {
      if (!matchesIntegrity(file.body, f.integrity)) problems.push(`${f.path} does not match its integrity hash`);
      const t = typeProblem(f.path, file.contentType);
      if (t) problems.push(t);
    }
  }
  return problems;
}

/** Problems with a manifest URL as the reader would load it from `origin`; [] when it is good. */
export async function smokeUrl(manifestUrl: string, origin: string): Promise<{ version?: string; problems: string[] }> {
  const get = (url: string) => fetch(url, { headers: { origin }, cache: "no-store" });
  const problems: string[] = [];
  const cors = (res: Response, what: string) => {
    const acao = res.headers.get("access-control-allow-origin");
    if (acao !== "*" && acao !== origin) problems.push(`${what} has no CORS header for ${origin} (got ${acao ?? "none"})`);
  };
  let res: Response;
  try {
    res = await get(manifestUrl);
  } catch (e) {
    return { problems: [`${manifestUrl}: ${(e as Error).message}`] };
  }
  if (!res.ok) return { problems: [`${manifestUrl}: HTTP ${res.status}`] };
  cors(res, manifestUrl);
  let manifest;
  try {
    manifest = parseManifest(await res.text(), manifestUrl);
  } catch (e) {
    return { problems: [...problems, (e as Error).message] };
  }
  if (!SERVED_MAJORS.includes(manifest.contract)) problems.push(`contract major ${manifest.contract} is not served`);
  const base = res.url || manifestUrl;
  for (const f of manifestFiles(manifest)) {
    const url = new URL(f.path, base).href;
    const r = await get(url).catch(() => null);
    if (!r?.ok) {
      problems.push(`${url}: ${r ? `HTTP ${r.status}` : "unreachable"}`);
      continue;
    }
    cors(r, url);
    if (!matchesIntegrity(new Uint8Array(await r.arrayBuffer()), f.integrity))
      problems.push(`${url} does not match its integrity hash`);
    const t = typeProblem(url, r.headers.get("content-type"));
    if (t) problems.push(t);
  }
  return { version: manifest.version, problems };
}

/** The server smoke test: health is up, protected routes refuse a request without a token. */
export const SERVER_CHECKS: [method: string, path: string, status: number][] = [
  ["GET", "/api/v1/health", 200],
  ["GET", "/api/v1/rooms", 401],
  ["GET", "/api/v1/feed", 401],
];

export async function smokeServer(apiOrigin: string): Promise<string[]> {
  const problems: string[] = [];
  for (const [method, p, status] of SERVER_CHECKS) {
    const res = await fetch(new URL(p, apiOrigin), { method, signal: AbortSignal.timeout(10_000) }).catch((e: Error) => e);
    if (res instanceof Error) problems.push(`${method} ${p}: ${res.message}`);
    else if (res.status !== status) problems.push(`${method} ${p} -> ${res.status} (expected ${status})`);
  }
  return problems;
}
