// Acceptance tests for spec 082 (test-only personas, QA seed and reset), L2 on real Postgres. App modules load through
// import.meta.glob so that, on a base without them, the first assertion fails.
import { inject, describe, expect, it } from "vitest";
import { importJWK, exportJWK, generateKeyPair } from "jose";
import { getRouter } from "~/router";
import type * as PersonasModule from "~/server/qa/personas";
import type * as SeedModule from "~/server/db/qa-seed";

const personaModules = import.meta.glob<typeof PersonasModule>("./server/qa/personas.ts");
const seedModules = import.meta.glob<typeof SeedModule>("./server/db/qa-seed.ts");
const seedFiles = import.meta.glob<unknown>("../../e2e/qa/seeds/*.json", { import: "default" });

async function personas() {
  const mod = await personaModules["./server/qa/personas.ts"]?.();
  expect(mod, "app/src/server/qa/personas.ts exists").toBeDefined();
  return mod!;
}
const load = async () => (await import("../../test/integration/harness")).harness(getRouter());

/** The served route tree as a fetch handler, the way the built server dispatches (match, then the method's handler). */
async function routeTreeFetch(req: Request): Promise<Response> {
  const { handlersOf } = await import("../../test/integration/harness");
  const url = new URL(req.url);
  const [, params, found] = getRouter().getMatchedRoutes(url.pathname);
  const handlers = handlersOf(found) as Record<string, (ctx: unknown) => Promise<Response>>;
  const handler = handlers[req.method] ?? handlers.ANY;
  if (!handler) return new Response("not found", { status: 404 });
  return handler({ request: req, params, pathname: url.pathname });
}

async function qa(environment: string | undefined, secret: string | undefined) {
  const { withQaRoutes } = await personas();
  const key = (await importJWK(inject("privateJwk"), "RS256")) as CryptoKey;
  const other = await generateKeyPair("RS256", { extractable: true });
  return withQaRoutes(routeTreeFetch, {
    environment,
    secret,
    signing: {
      key,
      kid: inject("kid"),
      publicJwk: await exportJWK(other.publicKey),
      issuer: inject("issuer"),
      audience: "sefaria-social",
    },
    harnessOrigin: "http://127.0.0.1:3300",
  });
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://qa.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("spec 082: personas", () => {
  // @feature IDENT-082 Test-only persona sessions
  // @ac 082/AC-001
  it("issues a persona's token and a one-time sign-in ticket in a test environment with the secret; /api/v1/me knows them", async () => {
    await load();
    const handle = await qa("test-ci", "per-run-secret");
    const res = await handle(post("/api/test/persona", { persona: "learner" }, { "x-qa-persona-secret": "per-run-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: number; token: string; signInUrl: string };
    expect(body.userId).toBe(900001);
    const me = await handle(new Request("http://qa.test/api/v1/me", { headers: { authorization: `Bearer ${body.token}` } }));
    expect([me.status, await me.json()]).toEqual([200, { userId: 900001, name: "Learner Persona" }]);

    const ticket = new URL(body.signInUrl).searchParams.get("qa-ticket");
    expect(new URL(body.signInUrl).origin).toBe("http://127.0.0.1:3300");
    const first = await handle(post("/api/test/persona/redeem", { ticket }));
    const again = await handle(post("/api/test/persona/redeem", { ticket }));
    expect([first.status, again.status]).toEqual([200, 404]);
    expect(((await first.json()) as { token: string }).token).toBe(body.token);
  });

  // @feature IDENT-082 Test-only persona sessions
  // @ac 082/AC-002
  it("refuses with 403 and issues nothing: production, a missing or wrong secret, or no secret configured", async () => {
    const cases = [
      ["production", "s3cret", "s3cret"],
      ["staging", "s3cret", "s3cret"],
      ["tested", "s3cret", "s3cret"],
      ["test-ci", "s3cret", null],
      ["test-ci", "s3cret", "wrong!"],
      ["test-ci", undefined, "anything"],
      [undefined, "s3cret", "s3cret"],
    ] as const;
    const answers: [string, number, boolean][] = [];
    for (const [env, secret, header] of cases) {
      const handle = await qa(env, secret);
      const res = await handle(post("/api/test/persona", { persona: "host" }, header ? { "x-qa-persona-secret": header } : {}));
      answers.push([`${env}/${secret}/${header}`, res.status, JSON.stringify(await res.json()).includes("token")]);
    }
    expect(answers).toEqual(cases.map(([env, secret, header]) => [`${env}/${secret}/${header}`, 403, false]));
  });

  // @feature IDENT-082 Test-only persona sessions
  // @ac 082/AC-003
  it("the production route table has no persona route: nothing under /api/test, nothing that mentions personas", async () => {
    await personas();
    const paths = Object.values(getRouter().routesById as unknown as Record<string, { fullPath?: string }>)
      .map((r) => r.fullPath ?? "")
      .filter(Boolean);
    expect(paths.filter((p) => p.startsWith("/api/test") || /persona/i.test(p))).toEqual([]);
    expect(paths).toContain("/api/v1/me");
    // And the production server, asked for it, answers as for any unknown path.
    const res = await routeTreeFetch(post("/api/test/persona", { persona: "learner" }, { "x-qa-persona-secret": "x" }));
    expect(res.status).not.toBe(200);
  });
});

describe("spec 082: seed and reset", () => {
  // @feature OPS-092 Idempotent QA seed and schema-checked reset
  // @ac 082/AC-004
  it("seeding a scenario twice creates nothing the second time", async () => {
    const mod = await seedModules["./server/db/qa-seed.ts"]?.();
    expect(mod, "app/src/server/db/qa-seed.ts exists").toBeDefined();
    const h = await load();
    const { getDb } = await import("~/server/db/client");
    const seed = await seedFiles["../../e2e/qa/seeds/room-seeded.json"]!();
    await mod!.seedScenario(getDb(), seed);
    const once = await mod!.rowCounts(h.pool);
    await mod!.seedScenario(getDb(), seed);
    expect(await mod!.rowCounts(h.pool)).toEqual(once);
    expect([once.rooms, once.room_members, once.user_display]).toEqual([1, 2, 2]);
  });

  // @feature OPS-092 Idempotent QA seed and schema-checked reset
  // @ac 082/AC-005
  it("reset leaves zero rows in every table the schema has", async () => {
    const mod = await seedModules["./server/db/qa-seed.ts"]?.();
    expect(mod, "app/src/server/db/qa-seed.ts exists").toBeDefined();
    const h = await load();
    const { getDb } = await import("~/server/db/client");
    for (const file of Object.keys(seedFiles)) await mod!.seedScenario(getDb(), await seedFiles[file]!());
    await h.sql("insert into webhook_receipts (event_id, event_type) values ('evt-x', 'user.deleted')");
    await h.sql("insert into deleted_users (user_id) values (900004)");
    const tables = await mod!.schemaTables(h.pool);
    expect(tables.length).toBeGreaterThanOrEqual(7);
    const after = await mod!.resetAll(h.pool);
    expect(after).toEqual(Object.fromEntries(tables.map((t) => [t, 0])));
  });
});
