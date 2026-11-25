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
