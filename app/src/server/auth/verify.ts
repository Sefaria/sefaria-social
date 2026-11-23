// Verify Django's social identity token (plan section 6.1, option A): an RS256 JWT checked against the published JWKS with
// jose. Never hand-rolled. Keys are cached per JWKS URL; an unknown `kid` refetches (key rotation), at most every 30 s; a
// JWKS that does not answer in 3 s makes identity unavailable (503), never open.
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { getConfig } from "../config";
import { ApiError } from "../http/errors";
import { log } from "../log/logger";
import { identityFromClaims, type Identity } from "./identity";

export const JWKS_TIMEOUT_MS = 3_000;
export const JWKS_COOLDOWN_MS = 30_000;
export const JWKS_CACHE_MAX_AGE_MS = 10 * 60_000;
const CLOCK_TOLERANCE_S = 30;

export interface VerifyOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(url: string) {
  let set = keySets.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    });
    keySets.set(url, set);
  }
  return set;
}

/** Forget cached key sets (tests point at fresh JWKS servers). */
export function resetKeySets(): void {
  keySets.clear();
}

/** The JWKS could not be read: timeout, network error, non-200, or not a key set. Everything else is a bad token. */
function isUnavailable(e: unknown): boolean {
  if (e instanceof errors.JWKSTimeout || e instanceof errors.JWKSInvalid) return true;
  if (!(e instanceof errors.JOSEError)) return true;
  return e.code === "ERR_JOSE_GENERIC";
}

export function verifyOptionsFromConfig(): VerifyOptions | null {
  const c = getConfig();
  if (!c.SOCIAL_JWKS_URL || !c.SOCIAL_TOKEN_ISSUER) return null;
  return { jwksUrl: c.SOCIAL_JWKS_URL, issuer: c.SOCIAL_TOKEN_ISSUER, audience: c.SOCIAL_TOKEN_AUDIENCE };
}

/** Returns the caller's identity, or throws ApiError 401 auth.invalid_token / 503 auth.unavailable. */
export async function verifyToken(token: string, options: VerifyOptions | null = verifyOptionsFromConfig()): Promise<Identity> {
  if (!options) {
    log.error("auth.not_configured");
    throw new ApiError(503, "auth.unavailable");
  }
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, keySet(options.jwksUrl), {
      algorithms: ["RS256"],
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: CLOCK_TOLERANCE_S,
      requiredClaims: ["sub", "exp", "iat"],
    }));
  } catch (e) {
    if (isUnavailable(e)) {
      log.error("auth.jwks_unavailable", { error: e instanceof Error ? e.name : "unknown" });
      throw new ApiError(503, "auth.unavailable");
    }
    throw new ApiError(401, "auth.invalid_token");
  }
  const identity = identityFromClaims(payload);
  if (!identity) throw new ApiError(401, "auth.invalid_token");
  return identity;
}
