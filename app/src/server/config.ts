// Server configuration, read from the environment and validated with zod (plan section 6). Read lazily: importing server
// code never needs a database or a key, so the route tree, the OpenAPI generator and unit tests load without one.
// Never log a value from here; the webhook secret and the database URL are secrets.
import { z } from "zod";

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
