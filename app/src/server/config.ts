// Server configuration, read from the environment and validated with zod (plan section 6). Read lazily: importing server
// code never needs a database or a key, so the route tree, the OpenAPI generator and unit tests load without one.
// Never log a value from here; the webhook secret and the database URL are secrets.
import { z } from "zod";

/** Coolify substitutes "" for a variable not set on the app: an empty value means unset (spec 040). */
const emptyIsUnset = (v: unknown) => (v === "" ? undefined : v);

const Env = z.object({
  /** Postgres connection string, for example postgres://user:pass@host:5432/sefaria_social. */
  DATABASE_URL: z.string().min(1).default("postgres://localhost:5432/sefaria_social"),
  /** Django's published keys: https://<sefaria origin>/.well-known/sefaria-social-jwks.json */
  SOCIAL_JWKS_URL: z.url().optional(),
  /** The `iss` Django puts in the token: SOCIAL_TOKEN_ISSUER on the Django side (no trailing slash). */
  SOCIAL_TOKEN_ISSUER: z.string().min(1).optional(),
  /** The `aud` Django puts in the token. */
  SOCIAL_TOKEN_AUDIENCE: z.string().min(1).default("sefaria-social"),
  /** HMAC key shared with Django's USER_DELETED_WEBHOOK_SECRET. */
  USER_DELETED_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** The relay's base URL for its internal routes (status, drop-user), for example https://rooms.sefaria.org. */
  RELAY_INTERNAL_URL: z.url().optional(),
  /** Shared with the relay's RELAY_INTERNAL_SECRET. */
  RELAY_INTERNAL_SECRET: z.string().min(1).optional(),
  /** Origins whose pages may call the API from a browser (CORS), comma-separated: the reader's origins. */
  SOCIAL_ALLOWED_ORIGINS: z.string().optional(),
  /** The LiveKit server clients connect to (spec 033), for example wss://sefaria.livekit.cloud. */
  LIVEKIT_URL: z.preprocess(emptyIsUnset, z.url({ protocol: /^wss?$/ }).optional()),
  /** LiveKit API key and secret: they sign call tokens. Secret; never sent to a browser or logged. */
  LIVEKIT_API_KEY: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  LIVEKIT_API_SECRET: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  /** Calls are offered only when this is exactly "true" and the three LiveKit variables are set. */
  CALLS_ENABLED: z.preprocess(emptyIsUnset, z.string().optional()),
  /** Session recordings (spec 041): "false" switches them off; anything else, or unset, leaves them on. */
  RECORDINGS_ENABLED: z.preprocess(emptyIsUnset, z.string().optional()),
  /** Spec 051: the filesystem object store's root for shiur assets (default `.data/assets` under the working directory). */
  ASSET_STORE_DIR: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  /** Spec 052: "off" keeps the asset processing worker from starting in this process (tests); anything else leaves it on. */
  ASSET_WORKER: z.preprocess(emptyIsUnset, z.string().optional()),
  /** Spec 054: the Sofer.ai API key (secret; never logged or sent to a browser). Unset: transcripts are unavailable. */
  SOFER_API_KEY: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  /** Spec 054: Sofer.ai's API base (tests point it at a fake). */
  SOFER_API_URL: z.preprocess(emptyIsUnset, z.url().default("https://api.sofer.ai")),
  /**
   * Spec 054: this server's public origin (https://social.sefaria.org). With it, Sofer.ai fetches a shiur's audio from the
   * public asset URL; without it the audio is sent in the request (base64).
   */
  SOCIAL_PUBLIC_ORIGIN: z.preprocess(emptyIsUnset, z.url().optional()),
  /**
   * Spec 059: Sefaria's account lookup by email (`POST /api/social/user-lookup` on the main site), and the HMAC key shared
   * with Django's SOCIAL_LOOKUP_SECRET. Either unset: an invited address is always emailed, never looked up.
   */
  SEFARIA_LOOKUP_URL: z.preprocess(emptyIsUnset, z.url().optional()),
  SEFARIA_LOOKUP_SECRET: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  /** Spec 059: the Resend API key (secret). Unset: inviting by email is unavailable. */
  RESEND_API_KEY: z.preprocess(emptyIsUnset, z.string().min(1).optional()),
  /** Spec 059: Resend's API base (tests point it at a fake). */
  RESEND_API_URL: z.preprocess(emptyIsUnset, z.url().default("https://api.resend.com")),
  /** Spec 059: the invitation email's sender, an address on a domain verified with Resend. */
  INVITE_EMAIL_FROM: z.preprocess(emptyIsUnset, z.string().min(3).default("Sefaria <invitations@sefaria.org>")),
  /** Spec 059: where a room's link in an email points: <ROOM_LINK_ORIGIN>/social/r/<roomId>. */
  ROOM_LINK_ORIGIN: z.preprocess(emptyIsUnset, z.url().default("https://www.sefaria.org")),
  /** Spec 060: the Sefaria API that checks and expands refs (`POST <origin>/api/refs/expand`). */
  SEFARIA_API_ORIGIN: z.preprocess(emptyIsUnset, z.url({ protocol: /^https?$/ }).default("https://www.sefaria.org")),
  /** Spec 060: a Claude asset file's size limit in bytes (5 MB). */
  ASSET_MAX_BYTES: z.preprocess(emptyIsUnset, z.coerce.number().int().positive().max(10_000_000).default(5_242_880)),
  /** Spec 060: new asset versions a user may save in 24 hours. */
  ASSET_DAILY_LIMIT: z.preprocess(emptyIsUnset, z.coerce.number().int().positive().default(20)),
  /** Spec 060: the most segments one asset's refs may expand to. */
  ASSET_MAX_SEGMENTS: z.preprocess(emptyIsUnset, z.coerce.number().int().positive().default(2000)),
  /**
   * Spec 061: the origin that serves asset files, never the API's own or a sefaria.org one. In development the Social server
   * itself under another host name (127.0.0.1 instead of localhost). When set, content routes answer 404 on other origins.
   */
  ASSET_CONTENT_ORIGIN: z.preprocess(emptyIsUnset, z.url({ protocol: /^https?$/ }).optional()),
  /** Spec 061: HMAC key for a shiur's open-network content URLs. Unset: none are issued and every grant is refused. */
  ASSET_CONTENT_SECRET: z.preprocess(emptyIsUnset, z.string().min(16).optional()),
  /** Spec 061: hosts a public asset may load scripts, styles and fonts from, when ASSET_TRUSTED_CDNS_ENABLED is "true". */
  ASSET_TRUSTED_CDNS: z.preprocess(
    emptyIsUnset,
    z.string().default("cdnjs.cloudflare.com,cdn.jsdelivr.net,unpkg.com,fonts.googleapis.com,fonts.gstatic.com"),
  ),
  ASSET_TRUSTED_CDNS_ENABLED: z.preprocess(emptyIsUnset, z.string().optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

/** The validated configuration. Throws (without echoing values) when a variable is malformed. */
export function getConfig(): Config {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Invalid server configuration: ${names}. See docs/runbooks/server.md for the variables.`);
  }
  cached = parsed.data;
  return cached;
}

/** Forget the cached configuration (tests change the environment between files). */
export function resetConfig(): void {
  cached = undefined;
}
