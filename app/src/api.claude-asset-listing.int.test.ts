// Acceptance tests for spec 063 AC-005 and AC-006 (a profile's public Claude assets, an asset as a post's card), L2: real
// Postgres through the route tree, Sefaria's expansion faked by its HTTP surface.
// @feature FEED-078 A profile's public Claude assets
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import type * as FakeSefariaModule from "../../test/integration/fake-sefaria";

// Loaded through import.meta.glob: on a base without it, each test fails on its first assertion (prove-red).
const fakeModules = import.meta.glob<typeof FakeSefariaModule>("../../test/integration/fake-sefaria.ts");
type FakeSefaria = FakeSefariaModule.FakeSefaria;
let assetHtml: typeof FakeSefariaModule.assetHtml;

const LIST = "/api/v1/profiles/$profileId/claude-assets";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Saved = { asset: { id: string }; version: { id: string } };
const U = 965001;
const V = 965002;
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

let sefaria: FakeSefaria;
beforeAll(async () => {
  const m = await fakeModules["../../test/integration/fake-sefaria.ts"]?.();
  if (!m) return; // the base: every test fails on its first assertion
  assetHtml = m.assetHtml;
  sefaria = await m.startFakeSefaria();
});
afterAll(async () => {
  await sefaria?.close();
});

async function load() {
  process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-listing-"));
  process.env.SEFARIA_API_ORIGIN = sefaria?.origin ?? "http://127.0.0.1:9";
  process.env.ASSET_CONTENT_ORIGIN = "http://social.test";
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const u = await h.token(U, { name: "Rav U" });
  const v = await h.token(V, { name: "Rav V" });
  const save = async (token: string, refs: string[], title: string, description = "About it") =>
    (await h.call("POST", "/api/v1/claude-assets", { token, body: { html: assetHtml(refs, { title, description }) } }))
      .json as Saved;
  const a = await save(u, ["Genesis 1:1-5"], "A");
  const b = await save(v, ["Genesis 2:1-3"], "B", "B's story");
  const c = await save(v, ["Genesis 3:1"], "C");
  await h.sql("update profiles set verified = true where user_id = $1", [V]);
  await h.call("POST", `/api/v1/claude-assets/${b.asset.id}/publish`, { token: v, body: {} });
  const vProfile = ((await h.call("GET", "/api/v1/profiles/me", { token: v })).json as { id: string }).id;
  return { h, u, v, a, b, c, vProfile };
}

describe("spec 063: assets on profiles and in posts", () => {
  // @ac 063/AC-005
  it("lists a person's published, not hidden assets to anyone", async () => {
    expect(served("GET", LIST), `GET ${LIST} is served`).toBeTypeOf("function");
    const { h, b, vProfile } = await load();
    const r = await h.call("GET", `/api/v1/profiles/${vProfile}/claude-assets`);
    expect([r.status, r.json]).toEqual([
      200,
      {
        assets: [
          {
            id: b.asset.id,
            title: "B",
            description: "B's story",
            refs: ["Genesis 2:1-3"],
            versionId: b.version.id,
            contentUrl: `http://social.test/api/v1/claude-assets/content/${b.version.id}`,
            publishedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
          },
        ],
      },
    ]);
    await h.sql("update assets set hidden = true where id = $1", [b.asset.id]);
    expect((await h.call("GET", `/api/v1/profiles/${vProfile}/claude-assets`)).json).toEqual({ assets: [] });
    expect((await h.call("GET", `/api/v1/profiles/${MISSING}/claude-assets`)).status).toBe(404);
  });

  // @feature FEED-077 Claude assets as post cards and on profile and shiur pages
  // @ac 063/AC-006
  it("lets a post embed the author's own asset or a published one, and refuses any other", async () => {
    expect(served("GET", LIST), `GET ${LIST} is served`).toBeTypeOf("function");
    const { h, u, v, a, b, c } = await load();
    const post = (token: string, id: string) =>
      h.call("POST", "/api/v1/posts", { token, body: { body: "", embed: { kind: "asset", id } } });
    const embedOf = (r: { status: number; json: unknown }) => [
      r.status,
      (r.json as { assetEmbed?: unknown }).assetEmbed,
      "embed" in (r.json as object),
    ];
    expect(embedOf(await post(v, b.asset.id))).toEqual([
      201,
      {
        id: b.asset.id,
        title: "B",
        leader: "Rav V",
        contentUrl: `http://social.test/api/v1/claude-assets/content/${b.version.id}`,
      },
      false,
    ]);
    expect(embedOf(await post(u, a.asset.id))).toEqual([
      201,
      {
        id: a.asset.id,
        title: "A",
        leader: "Rav U",
        contentUrl: `http://social.test/api/v1/claude-assets/content/${a.version.id}`,
      },
      false,
    ]);
    const before = await h.sql("select count(*)::int as n from posts");
    expect([(await post(u, c.asset.id)).status, (await post(u, MISSING)).status]).toEqual([404, 404]);
    expect(await h.sql("select count(*)::int as n from posts")).toEqual(before);
    const live = await h.call("GET", `/api/v1/live?ids=${b.asset.id}`);
    expect([live.status, live.json], "an asset has no live state").toEqual([200, []]);
  });
});
