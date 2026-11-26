// How a Claude asset's file is served (spec 061; plan 6.6, D7): from its own origin (ASSET_CONTENT_ORIGIN), always sandboxed,
// with one of two policies the server decides by the URL it gave out. The public URL gets the closed policy (no network but an
// optional list of trusted CDNs); the open policy is served only at a shiur URL whose grant is signed with
// ASSET_CONTENT_SECRET, names the shiur, and expires (decision 0015 point 6). No database here.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config";

export const DEFAULT_CONTENT_ORIGIN = "http://127.0.0.1:3200";
export const GRANT_LIFETIME_S = 30 * 60;
export const CONTENT_PATH = "/api/v1/claude-assets/content";

const origins = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** The origins that may frame an asset: the reader's (SOCIAL_ALLOWED_ORIGINS), or none. */
export function frameAncestors(): string {
  const list = origins(getConfig().SOCIAL_ALLOWED_ORIGINS);
  return list.length ? list.join(" ") : "'none'";
}

/** The trusted CDN hosts as https origins, or none while ASSET_TRUSTED_CDNS_ENABLED is not "true". */
export function trustedCdns(): string[] {
  const c = getConfig();
  if (c.ASSET_TRUSTED_CDNS_ENABLED !== "true") return [];
  return origins(c.ASSET_TRUSTED_CDNS)
    .filter((h) => /^[a-z0-9.-]+$/i.test(h))
    .map((h) => `https://${h.toLowerCase()}`);
}

const common = () => ["sandbox allow-scripts", `frame-ancestors ${frameAncestors()}`, "base-uri 'none'", "form-action 'none'"];

/** The sidebar's and public pages' policy: sandboxed, no network (no connect-src), inline code, data and blob media. */
export function publicPolicy(): string {
  const cdns = trustedCdns();
  const plus = cdns.length ? ` ${cdns.join(" ")}` : "";
  return [
    ...common(),
    "default-src 'none'",
    `script-src 'unsafe-inline'${plus}`,
    `style-src 'unsafe-inline'${plus}`,
    "img-src data: blob:",
    "media-src data: blob:",
    `font-src data:${plus}`,
  ].join("; ");
}

/** A shiur's policy: still sandboxed and framed only by the reader, every source allowed (D7). */
export function shiurPolicy(): string {
  return [
    ...common(),
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "style-src * data: blob: 'unsafe-inline'",
    "img-src * data: blob:",
    "media-src * data: blob:",
    "font-src * data:",
    "connect-src *",
  ].join("; ");
}

/** The origin content is served from. */
export function contentOrigin(): string {
  return new URL(getConfig().ASSET_CONTENT_ORIGIN ?? DEFAULT_CONTENT_ORIGIN).origin;
}

/** A version's public URL (closed policy). */
export const contentUrl = (versionId: string) => `${contentOrigin()}${CONTENT_PATH}/${versionId}`;

/** When ASSET_CONTENT_ORIGIN is set, content is answered only on that origin. */
export function onContentOrigin(request: Request): boolean {
  const configured = getConfig().ASSET_CONTENT_ORIGIN;
  if (!configured) return true;
  return new URL(request.url).origin === new URL(configured).origin;
}

const mac = (secret: string, shiurId: string, versionId: string, exp: number) =>
  createHmac("sha256", secret).update(`shiur:${shiurId}:${versionId}:${exp}`).digest("base64url");

/** A signed grant for a version in a shiur, `<shiurId>.<exp>.<mac>`; null when ASSET_CONTENT_SECRET is not set. */
export function shiurGrant(shiurId: string, versionId: string, nowS = Math.floor(Date.now() / 1000)): string | null {
  const secret = getConfig().ASSET_CONTENT_SECRET;
  if (!secret) return null;
  const exp = nowS + GRANT_LIFETIME_S;
  return `${shiurId}.${exp}.${mac(secret, shiurId, versionId, exp)}`;
}

/** The shiur URL of a version (open policy), or null without a secret. */
export function shiurContentUrl(shiurId: string, versionId: string, nowS?: number): string | null {
  const grant = shiurGrant(shiurId, versionId, nowS);
  return grant ? `${contentOrigin()}${CONTENT_PATH}/${versionId}/shiur/${grant}` : null;
}

const GRANT = /^([0-9a-f-]{36})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

/** The shiur a grant names, if it is signed for this version and not expired; null otherwise. */
export function checkGrant(grant: string, versionId: string, nowS = Math.floor(Date.now() / 1000)): string | null {
  const secret = getConfig().ASSET_CONTENT_SECRET;
  const m = GRANT.exec(grant);
  if (!secret || !m) return null;
  const [, shiurId, expText, given] = m;
  const exp = Number(expText);
  if (exp <= nowS) return null;
  const want = Buffer.from(mac(secret, shiurId!, versionId, exp));
  const got = Buffer.from(given!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return shiurId!;
}
