// Acceptance tests for spec 057 (profile handles), L2: real Postgres (migration 0012's trigger and backfill rules) through the
// route tree. Each test first asserts the by-handle route is served, so on a base without handles it fails there.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const BY_HANDLE = "/api/v1/profiles/by-handle/$handle";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type Me = { id: string; name: string; handle: string; bio: string };
type ErrorJson = { error: { code: string } };
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

/** A word no earlier run has used, so handles made from it are predictable. */
const fresh = () => `t${randomBytes(4).toString("hex")}`;
let nextUser = 957_000 + Math.floor(Math.random() * 1000) * 10;
const user = () => nextUser++;

const me = async (h: H, token: string) => (await h.call("GET", "/api/v1/profiles/me", { token })).json as Me;
const patch = (h: H, token: string, body: unknown) => h.call("PATCH", "/api/v1/profiles/me", { token, body });

describe("spec 057: profile handles", () => {
  // @feature IDENT-104 Profile @handles, unique and made from the name
  // @ac 057/AC-001
  it("gives a new profile a handle from its name, with a number when it is taken, and 'learner' for a name without Latin letters", async () => {
    expect(served("GET", BY_HANDLE), `GET ${BY_HANDLE} is served`).toBeTypeOf("function");
    const h = await load();
    const word = fresh();
    const first = await me(h, await h.token(user(), { name: `Rachel ${word}` }));
    expect(first.handle).toBe(`rachel_${word}`);
    const second = await me(h, await h.token(user(), { name: `RACHEL ${word}!` }));
    expect(second.handle).toBe(`rachel_${word}2`);
    const hebrew = await me(h, await h.token(user(), { name: "רחל כהן" }));
    expect(hebrew.handle).toMatch(/^learner\d*$/);
    const reserved = await me(h, await h.token(user(), { name: "Admin" }));
    expect(reserved.handle).toMatch(/^admin_\d*$/);
    // An institution made outside Social (staff SQL) gets one too.
    const [shul] = await h.sql<{ handle: string }>(
      "insert into profiles (kind, name) values ('institution', $1) returning handle",
      [`Shul ${word}`],
    );
    expect(shul!.handle).toBe(`shul_${word}`);
  });

  // @feature IDENT-104 Profile @handles, unique and made from the name
  // @ac 057/AC-002
  it("saves a handle in canonical form, and refuses an invalid, reserved or taken one without changing anything", async () => {
    expect(served("GET", BY_HANDLE), `GET ${BY_HANDLE} is served`).toBeTypeOf("function");
    const h = await load();
    const word = fresh();
    const token = await h.token(user(), { name: "Rachel Cohen" });
    const saved = await patch(h, token, { handle: `@Rachel_${word.toUpperCase()}`, bio: "Daf every day" });
    expect([saved.status, (saved.json as Me).handle, (saved.json as Me).bio]).toEqual([200, `rachel_${word}`, "Daf every day"]);
    // Full-width letters are the same handle once in canonical form (NFKC).
    const wide = await patch(h, token, { handle: `ｒａｃｈｅｌ_${word}` });
    expect([wide.status, (wide.json as Me).handle]).toEqual([200, `rachel_${word}`]);
    for (const bad of ["ab", "1abc", "has space", "a".repeat(31), "admin", "rachel-c"])
      expect(code(await patch(h, token, { handle: bad, name: "Changed" })), bad).toBe("400 profile.handle_invalid");
    // Longer than 64 characters is refused by the request's schema before any pattern runs.
    expect((await patch(h, token, { handle: "x".repeat(200) })).status).toBe(400);
    const other = await h.token(user(), { name: "Someone Else" });
    expect(code(await patch(h, other, { handle: `RACHEL_${word}`, name: "Changed" }))).toBe("409 profile.handle_taken");
    expect((await me(h, other)).name).toBe("Someone Else");
    expect((await me(h, token)).handle).toBe(`rachel_${word}`);
  });

  // @feature IDENT-104 Profile @handles, unique and made from the name
  // @ac 057/AC-003
  it("puts the handle in profiles and post authors, and finds a profile by its handle in any case", async () => {
    expect(served("GET", BY_HANDLE), `GET ${BY_HANDLE} is served`).toBeTypeOf("function");
    const h = await load();
    const word = fresh();
    const token = await h.token(user(), { name: "Ben" });
    await patch(h, token, { handle: `ben_${word}` });
    const own = await me(h, token);
    const viewer = await h.token(user(), { name: "Viewer" });
    const page = (await h.call("GET", `/api/v1/profiles/${own.id}`, { token: viewer })).json as {
      profile: Me;
      posts: unknown[];
    };
    expect(page.profile.handle).toBe(`ben_${word}`);
    const post = await h.call("POST", "/api/v1/posts", { token, body: { body: "Hello" } });
    expect((post.json as { author: { handle: string } }).author.handle).toBe(`ben_${word}`);
    for (const asked of [`ben_${word}`, `@BEN_${word}`, `Ben_${word.toUpperCase()}`]) {
      const found = await h.call("GET", `/api/v1/profiles/by-handle/${encodeURIComponent(asked)}`, { token: viewer });
      expect([found.status, (found.json as Me).id], asked).toEqual([200, own.id]);
    }
    expect(code(await h.call("GET", `/api/v1/profiles/by-handle/nobody_${word}`, { token: viewer }))).toBe(
      "404 profile.not_found",
    );
    expect((await h.call("GET", `/api/v1/profiles/by-handle/ben_${word}`)).status).toBe(401);
  });
});
