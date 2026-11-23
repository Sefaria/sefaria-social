// Test-only persona sessions (spec 082; plan 5.5). NOT part of the production server: no route file imports this, so the Start
// build never bundles it. Only app/scripts/qa-server.ts (the QA and e2e environment) mounts it, in front of the built server.
// Even there it answers only when the environment name matches ^test(-|$) AND the x-qa-persona-secret header equals
// QA_PERSONA_SECRET; anything else is 403 and issues nothing. Personas are invented people (e2e/qa/personas.md).
import { timingSafeEqual } from "node:crypto";
import { SignJWT, type CryptoKey, type JWK } from "jose";

export const PERSONA_PATH = "/api/test/persona";
export const REDEEM_PATH = "/api/test/persona/redeem";
export const JWKS_PATH = "/api/test/jwks";
export const SECRET_HEADER = "x-qa-persona-secret";
export const TEST_ENV = /^test(-|$)/;

/** Signed-in personas (the signed-out visitor needs no session). Ids are far from real ones; names are invented. */
export const PERSONAS = {
  learner: { id: 900001, name: "Learner Persona" },
  host: { id: 900002, name: "Host Persona" },
  follower: { id: 900003, name: "Follower Persona" },
  deleted: { id: 900004, name: "Deleted Persona" },
} as const;
export type PersonaName = keyof typeof PERSONAS;

export interface QaOptions {
  /** SOCIAL_ENV. */
  environment: string | undefined;
  /** QA_PERSONA_SECRET. Unset: every persona request is refused. */
  secret: string | undefined;
  signing: { key: CryptoKey; kid: string; publicJwk: JWK; issuer: string; audience: string };
  /** Where the harness lives, for the one-time sign-in URL. */
  harnessOrigin: string;
  /** Browser origins allowed to call the test routes (the harness redeems tickets from the page). Default: harnessOrigin. */
  corsOrigins?: string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function environmentAllows(environment: string | undefined): boolean {
  return typeof environment === "string" && TEST_ENV.test(environment);
}

export function secretMatches(given: string | null, secret: string | undefined): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The QA routes in front of an inner fetch handler (the built Start server). Returns the inner handler's answer for every
 * other path; for /api/health (the QA contract's health path) it asks the API's /api/v1/health.
 */
export function withQaRoutes(inner: (req: Request) => Promise<Response>, opts: QaOptions) {
  const tickets = new Map<string, { token: string; persona: PersonaName; expires: number }>();
  const allowed = environmentAllows(opts.environment);

  async function mint(persona: PersonaName): Promise<string> {
    const p = PERSONAS[persona];
    return new SignJWT({ name: p.name, staff: false, jti: crypto.randomUUID() })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: opts.signing.kid })
      .setIssuer(opts.signing.issuer)
      .setAudience(opts.signing.audience)
      .setSubject(String(p.id))
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(opts.signing.key);
  }

  const corsOrigins = new Set(opts.corsOrigins ?? [opts.harnessOrigin]);
  const withCors = (req: Request, res: Response) => {
    const origin = req.headers.get("origin");
    if (origin && corsOrigins.has(origin)) {
      res.headers.set("access-control-allow-origin", origin);
      res.headers.set("vary", "Origin");
    }
    return res;
  };

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/test/")) {
      if (req.method === "OPTIONS") {
        const res = withCors(req, new Response(null, { status: 204 }));
        if (res.headers.has("access-control-allow-origin")) {
          res.headers.set("access-control-allow-methods", "GET, POST");
          res.headers.set("access-control-allow-headers", `content-type, ${SECRET_HEADER}`);
        }
        return res;
      }
      return withCors(req, await testRoute(req, url));
    }
    return route(req, url);
  };

  async function route(req: Request, url: URL): Promise<Response> {
    if (url.pathname === "/api/health") return inner(new Request(new URL("/api/v1/health", url), { headers: req.headers }));
    return inner(req);
  }

  async function testRoute(req: Request, url: URL): Promise<Response> {
    if (!allowed) return json(403, { error: { code: "qa.forbidden", message: "Not a test environment." } });
    if (url.pathname === JWKS_PATH && req.method === "GET")
      return json(200, { keys: [{ ...opts.signing.publicJwk, kid: opts.signing.kid, alg: "RS256", use: "sig" }] });
    if (url.pathname === REDEEM_PATH && req.method === "POST") {
      const ticket = ((await req.json().catch(() => ({}))) as { ticket?: unknown }).ticket;
      const entry = typeof ticket === "string" ? tickets.get(ticket) : undefined;
      if (typeof ticket === "string") tickets.delete(ticket); // one time only
      if (!entry || entry.expires < Date.now())
        return json(404, { error: { code: "qa.ticket_unknown", message: "Unknown or used ticket." } });
      const p = PERSONAS[entry.persona];
      return json(200, { persona: entry.persona, userId: p.id, name: p.name, token: entry.token });
    }
    if (url.pathname === PERSONA_PATH && req.method === "POST") {
      if (!secretMatches(req.headers.get(SECRET_HEADER), opts.secret))
        return json(403, { error: { code: "qa.forbidden", message: "Missing or wrong persona secret." } });
      const persona = ((await req.json().catch(() => ({}))) as { persona?: unknown }).persona;
      if (typeof persona !== "string" || !(persona in PERSONAS))
        return json(400, { error: { code: "request.invalid", message: `Known personas: ${Object.keys(PERSONAS).join(", ")}.` } });
      const name = persona as PersonaName;
      const token = await mint(name);
      const ticket = crypto.randomUUID();
      tickets.set(ticket, { token, persona: name, expires: Date.now() + 5 * 60_000 });
      return json(200, {
        persona: name,
        userId: PERSONAS[name].id,
        token,
        signInUrl: `${opts.harnessOrigin}/social?qa-ticket=${ticket}`,
      });
    }
    return json(404, { error: { code: "qa.not_found", message: "No such test route." } });
  }
}
