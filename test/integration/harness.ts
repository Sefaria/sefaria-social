// The integration harness (L2): drives the API through the served route tree, the way TanStack Start dispatches a request
// (router.getMatchedRoutes, then the matched route's server handler for the method), against real Postgres, with tokens
// signed by the test key that the local JWKS server publishes. Acceptance tests load it after asserting their route is
// served, so on a base without the feature they fail on that assertion.
import { inject } from "vitest";
import "./context";
import { SignJWT, importJWK, type CryptoKey, type JWTPayload } from "jose";
import { resetConfig } from "../../app/src/server/config";
import { closeDb, getPool } from "../../app/src/server/db/client";
import { resetKeySets } from "../../app/src/server/auth/verify";
import { setLogSink } from "../../app/src/server/log/logger";
import { sign } from "../../app/src/server/webhooks/signature";

export const WEBHOOK_SECRET = "integration-test-webhook-secret";

/** The parts of the TanStack router the harness uses. */
export interface RouterLike {
  getMatchedRoutes: (pathname: string) => readonly [unknown, Record<string, string>, unknown];
  routesById: Record<string, unknown>;
}
interface ServerRoute {
  options?: { server?: { handlers?: Record<string, unknown> | ((o: { createHandlers: (d: unknown) => unknown }) => unknown) } };
}

export interface CallInit {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface TokenOptions {
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  alg?: string;
  kid?: string;
  key?: CryptoKey | Uint8Array;
}

export interface CallResult {
  status: number;
  headers: Headers;
  json: unknown;
}

export function handlersOf(route: unknown): Record<string, unknown> {
  const server = (route as ServerRoute | undefined)?.options?.server;
  const h = server?.handlers;
  if (!h) return {};
  return (typeof h === "function" ? h({ createHandlers: (d) => d }) : h) as Record<string, unknown>;
}

/** Dispatch like Start: match the path, pick the method's handler (or ANY), call it with the request and params. */
export async function dispatch(router: object, method: string, path: string, init: CallInit = {}): Promise<CallResult> {
  const [, params, found] = (router as RouterLike).getMatchedRoutes(path);
  const handlers = handlersOf(found);
  const handler = (handlers[method] ?? handlers.ANY) as
    ((ctx: { request: Request; params: Record<string, string>; pathname: string }) => Promise<Response>) | undefined;
  if (typeof handler !== "function") throw new Error(`No server handler for ${method} ${path}`);
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let body: string | undefined = init.rawBody;
  if (body === undefined && init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request(`http://social.test${path}`, { method, headers, body });
  const response = await handler({ request, params, pathname: path });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}

export async function harness(router: object) {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.SOCIAL_JWKS_URL = inject("jwksUrl");
  process.env.SOCIAL_TOKEN_ISSUER = inject("issuer");
  process.env.SOCIAL_TOKEN_AUDIENCE = "sefaria-social";
  process.env.USER_DELETED_WEBHOOK_SECRET = WEBHOOK_SECRET;
  resetConfig();
  resetKeySets();

  const logs: string[] = [];
  setLogSink((line) => logs.push(line));

  const pool = getPool();
  const tables = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  );
  if (tables.rows.length > 0)
    await pool.query(`truncate ${tables.rows.map((r) => `"${r.table_name}"`).join(", ")} restart identity cascade`);

  const privateKey = await importJWK(inject("privateJwk"), "RS256");

  /** A token as Django issues it (sso/social_token.py), signed by the key the local JWKS publishes. */
  async function token(userId: number | string = 4242, claims: JWTPayload = {}, opts: TokenOptions = {}) {
    return new SignJWT({ name: "Test Learner", staff: false, jti: `jti-${Math.random()}`, ...claims })
      .setProtectedHeader({ typ: "JWT", alg: opts.alg ?? "RS256", kid: opts.kid ?? inject("kid") })
      .setIssuer(opts.issuer ?? inject("issuer"))
      .setAudience(opts.audience ?? "sefaria-social")
      .setSubject(String(userId))
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "10m")
      .sign(opts.key ?? privateKey);
  }

  const call = (method: string, path: string, init: CallInit = {}) => dispatch(router, method, path, init);

  /** Post a webhook body signed like Django does (or with the signature given). */
  async function webhook(rawBody: string, signature: string | null = sign(WEBHOOK_SECRET, rawBody)) {
    const headers: Record<string, string> = {};
    if (signature !== null) headers["x-sefaria-signature"] = signature;
    return call("POST", "/api/v1/internal/user-deleted", { rawBody, headers });
  }

  const sql = <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    pool.query<R>(text, values).then((r) => r.rows);

  return { call, token, webhook, sql, logs, pool, close: closeDb };
}

export type Harness = Awaited<ReturnType<typeof harness>>;

export const CALLABLE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const SAMPLE_PARAM = "00000000-0000-4000-8000-000000000000";

export interface ProtectionReport {
  /** Every route under /api/ in the served route tree, as "/api/v1/rooms/$roomId". */
  routes: string[];
  /** "METHOD /path -> status" for every call made without credentials. */
  calls: string[];
  /** What breaks protect-by-default; empty when every non-public call was refused. */
  violations: string[];
}

/**
 * Protect-by-default, checked from the outside (spec 006 AC-004): call every method of every route the router serves under
 * /api/ with no credentials at all. Anything not on the public list must answer 401; a route under /api/ must be a server
 * route (no pages there).
 */
export async function protectionReport(router: object, publicList: ReadonlySet<string>): Promise<ProtectionReport> {
  const routes = Object.values((router as RouterLike).routesById)
    .map((r) => r as { fullPath?: string })
    .filter((r) => typeof r.fullPath === "string" && r.fullPath.startsWith("/api/"));
  const report: ProtectionReport = { routes: routes.map((r) => r.fullPath!).sort(), calls: [], violations: [] };
  for (const route of routes) {
    const template = route.fullPath!;
    const handlers = handlersOf(route);
    if (Object.keys(handlers).length === 0) {
      report.violations.push(`${template} is under /api/ but has no server handlers`);
      continue;
    }
    const path = template.replace(/\$[A-Za-z0-9_]+/g, SAMPLE_PARAM);
    const openApiPath = template.replace(/\$([A-Za-z0-9_]+)/g, "{$1}");
    for (const method of CALLABLE_METHODS) {
      if (!(method in handlers) && !("ANY" in handlers)) continue;
      const res = await dispatch(router, method, path);
      report.calls.push(`${method} ${template} -> ${res.status}`);
      const isPublic = publicList.has(`${method} ${openApiPath}`);
      if (!isPublic && res.status !== 401)
        report.violations.push(`${method} ${template} answered ${res.status} without credentials (expected 401)`);
    }
  }
  return report;
}
