// Acceptance tests for spec 060 (save a Claude asset), L2: real Postgres through the route tree, a fresh object store
// directory, and Sefaria's ref expansion faked by its HTTP surface (test/integration/fake-sefaria.ts). Each test first asserts
// its route is served, so on a base without the feature it fails on that assertion.
// @feature SHIUR-008 Save a Claude asset with its manifest and refs checked, as immutable versions
import { mkdtempSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import { resetConfig } from "~/server/config";
import { assetHtml, startFakeSefaria, type FakeSefaria } from "../../test/integration/fake-sefaria";

const SAVE = "/api/v1/claude-assets";
const ONE = "/api/v1/claude-assets/$assetId";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const STORE = mkdtempSync(path.join(tmpdir(), "social-claude-assets-"));
const OWNER = 960001;
const OTHER = 960002;
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

type Version = { id: string; n: number; sha256: string; bytes: number; contentUrl: string };
type Asset = {
  id: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  author: { name: string; profileId: string | null; verified: boolean };
  currentVersionId: string | null;
  versions: Version[];
  manifest: { refs: { ref: string; heRef: string; label: string | null; sectionRefs: string[]; segmentRefs: string[] }[] };
};
type Saved = { asset: Asset; version: Version; created: boolean; unchanged: boolean; firstRef: string };
type Refused = { error: { code: string; message: string }; problems: { code: string; message: string; ref?: string }[] };
const code = (r: { status: number; json: unknown }) =>
  `${r.status} ${(r.json as { error?: { code: string } } | null)?.error?.code ?? ""}`.trim();

let sefaria: FakeSefaria;
beforeAll(async () => {
  sefaria = await startFakeSefaria();
});
afterAll(async () => {
  await sefaria.close();
});

async function load() {
  process.env.ASSET_STORE_DIR = STORE;
  process.env.SEFARIA_API_ORIGIN = sefaria.origin;
  delete process.env.ASSET_DAILY_LIMIT;
  delete process.env.ASSET_MAX_BYTES;
  sefaria.mode = "ok";
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const owner = await h.token(OWNER, { name: "Chana Author" });
  const other = await h.token(OTHER, { name: "Other Learner" });
  const save = (token: string, body: Record<string, unknown>) => h.call("POST", SAVE, { token, body });
  return { h, owner, other, save };
}

const files = async (assetId: string) => {
  try {
    return (await readdir(path.join(STORE, "assets", assetId))).filter((n) => !n.endsWith(".tmp")).sort();
  } catch {
    return [];
  }
};

/** Every file under the store's assets/ folder. */
const allFiles = async () => {
  try {
    return (await readdir(path.join(STORE, "assets"), { recursive: true })).sort();
  } catch {
    return [];
  }
};

describe("spec 060: save a Claude asset", () => {
  // @ac 060/AC-001
  it("saves a valid file as an asset with version 1, its refs checked and expanded by Sefaria, its bytes in the store", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, save } = await load();
    const html = assetHtml([{ ref: "genesis 1:1-5", label: "Day one" }, "Genesis 1:6-8"]);
    const r = await save(owner, { html, title: "ignored" });
    expect(code(r)).toBe("400 request.invalid"); // a strict body: nothing beside the file may claim a title
    const ok = await save(owner, { html });
    const body = ok.json as Saved;
    expect([ok.status, body.created, body.unchanged, body.version.n, body.firstRef]).toEqual([
      201,
      true,
      false,
      1,
      "Genesis 1:1-5",
    ]);
    expect([body.asset.title, body.asset.description, body.asset.author.name, body.asset.author.verified]).toEqual([
      "The Seven Days",
      "A scrolling story of creation, tied to Genesis 1.",
      "Chana Author",
      false,
    ]);
    expect(body.asset.manifest.refs).toEqual([
      {
        ref: "Genesis 1:1-5",
        heRef: "בראשית 1:1-5",
        label: "Day one",
        sourceRef: "genesis 1:1-5",
        sectionRefs: ["Genesis 1"],
        segmentRefs: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3", "Genesis 1:4", "Genesis 1:5"],
      },
      {
        ref: "Genesis 1:6-8",
        heRef: "בראשית 1:6-8",
        label: null,
        sourceRef: "Genesis 1:6-8",
        sectionRefs: ["Genesis 1"],
        segmentRefs: ["Genesis 1:6", "Genesis 1:7", "Genesis 1:8"],
      },
    ]);
    expect(sefaria.requests.at(-1)).toEqual(["genesis 1:1-5", "Genesis 1:6-8"]);
    const sha = createHash("sha256").update(html).digest("hex");
    expect([body.version.sha256, body.version.bytes]).toEqual([sha, Buffer.byteLength(html)]);
    expect(await files(body.asset.id)).toEqual([`${sha}.html`]);
    expect(await readFile(path.join(STORE, "assets", body.asset.id, `${sha}.html`), "utf8")).toBe(html);
    const rows = await h.sql("select n, storage_key from asset_versions where asset_id = $1", [body.asset.id]);
    expect(rows).toEqual([{ n: 1, storage_key: `assets/${body.asset.id}/${sha}.html` }]);
  });

  // @ac 060/AC-002
  it("adds versions only for the owner, and the same bytes are never stored twice", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, other, save } = await load();
    const first = (await save(owner, { html: assetHtml(["Genesis 1:1-5"]) })).json as Saved;
    const changed = assetHtml(["Genesis 1:1-5"], { title: "The Seven Days, revised" });
    const v2 = await save(owner, { html: changed, assetId: first.asset.id });
    expect([
      v2.status,
      (v2.json as Saved).version.n,
      (v2.json as Saved).asset.currentVersionId,
      (v2.json as Saved).created,
    ]).toEqual([201, 2, (v2.json as Saved).version.id, false]);
    expect((v2.json as Saved).asset.title).toBe("The Seven Days, revised");
    for (const again of [{ html: changed, assetId: first.asset.id }, { html: changed }]) {
      const r = await save(owner, again);
      expect([r.status, (r.json as Saved).version.n, (r.json as Saved).unchanged, (r.json as Saved).asset.id]).toEqual([
        200,
        2,
        true,
        first.asset.id,
      ]);
    }
    expect(await h.sql("select n from asset_versions where asset_id = $1 order by n", [first.asset.id])).toEqual([
      { n: 1 },
      { n: 2 },
    ]);
    const before = await h.sql("select count(*)::int as n from asset_versions");
    expect(code(await save(other, { html: assetHtml(["Genesis 2:1"]), assetId: first.asset.id }))).toBe("404 asset.not_found");
    expect(code(await save(owner, { html: assetHtml(["Genesis 2:1"]), assetId: MISSING }))).toBe("404 asset.not_found");
    expect(await h.sql("select count(*)::int as n from asset_versions")).toEqual(before);
  });

  // @ac 060/AC-003
  it("refuses a file that cannot be saved with problems a model can act on, and stores nothing", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, save } = await load();
    process.env.ASSET_MAX_BYTES = "2000";
    resetConfig();
    const valid = assetHtml(["Genesis 1:1"]);
    const block = (json: string) => `<html><script type="application/json" id="sefaria-asset">${json}</script></html>`;
    const cases: [string, string][] = [
      [valid + "x".repeat(2000), "size.too_large"],
      ["<html><body>No manifest</body></html>", "manifest.missing"],
      [valid + valid, "manifest.multiple"],
      [block("{nope"), "manifest.json"],
      [block(JSON.stringify({ v: 2, title: "x", refs: [{ ref: "Genesis 1:1" }] })), "manifest.version"],
      [block(JSON.stringify({ v: 1, refs: [{ ref: "Genesis 1:1" }] })), "manifest.invalid"],
      [block(JSON.stringify({ v: 1, title: "x", refs: [] })), "refs.missing"],
      [assetHtml(["Genesis 1:1", "Genesis 99:1"]), "ref.invalid"],
    ];
    const stored = await allFiles();
    const got = [];
    for (const [html, want] of cases) {
      const r = await save(owner, { html });
      const body = r.json as Refused;
      got.push([r.status, body.error.code, body.problems.map((p) => p.code).join(","), want]);
    }
    expect(got).toEqual(cases.map(([, want]) => [422, "asset.invalid", want, want]));
    const bad = (await save(owner, { html: assetHtml(["Genesis 99:1"]) })).json as Refused;
    expect(bad.problems[0]!.ref).toBe("Genesis 99:1");
    expect(bad.problems[0]!.message).toMatch(/"Genesis 99:1" is not a ref Sefaria knows .*Sefaria's form/);
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 0 }]);
    expect(await allFiles()).toEqual(stored);
    delete process.env.ASSET_MAX_BYTES;
    resetConfig();
  });

  // @ac 060/AC-004
  it("checks a dry run without storing it or counting it", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, save } = await load();
    const html = assetHtml(["Genesis 1:1-5"]);
    const r = await save(owner, { html, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      dryRun: true,
      manifest: expect.objectContaining({
        v: 1,
        title: "The Seven Days",
        refs: [expect.objectContaining({ ref: "Genesis 1:1-5" })],
      }),
      bytes: Buffer.byteLength(html),
      sha256: createHash("sha256").update(html).digest("hex"),
      firstRef: "Genesis 1:1-5",
    });
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 0 }]);
    const bad = await save(owner, { html: assetHtml(["Genesis 99:1"]), dryRun: true });
    expect([bad.status, (bad.json as Refused).problems[0]!.code]).toEqual([422, "ref.invalid"]);
  });

  // @ac 060/AC-005
  it("refuses a save past the daily limit, per user", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, other, save } = await load();
    process.env.ASSET_DAILY_LIMIT = "2";
    resetConfig();
    expect((await save(owner, { html: assetHtml(["Genesis 1:1"]) })).status).toBe(201);
    expect((await save(owner, { html: assetHtml(["Genesis 1:2"]), dryRun: true })).status).toBe(200);
    expect((await save(owner, { html: assetHtml(["Genesis 1:3"]) })).status).toBe(201);
    const third = await save(owner, { html: assetHtml(["Genesis 1:4"]) });
    expect(code(third)).toBe("429 asset.daily_limit");
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 2 }]);
    expect((await save(other, { html: assetHtml(["Genesis 1:4"]) })).status).toBe(201);
    delete process.env.ASSET_DAILY_LIMIT;
    resetConfig();
  });

  // @ac 060/AC-006
  it("answers 503 and stores nothing when Sefaria cannot check the refs", async () => {
    expect(served("POST", SAVE), `POST ${SAVE} is served`).toBeTypeOf("function");
    const { h, owner, save } = await load();
    const got = [];
    for (const mode of ["error", "garbage"] as const) {
      sefaria.mode = mode;
      got.push(code(await save(owner, { html: assetHtml(["Genesis 1:1"]) })));
    }
    expect(got).toEqual(["503 asset.refs_unavailable", "503 asset.refs_unavailable"]);
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 0 }]);
  });

  // @ac 060/AC-008
  it("answers an asset to anyone without user ids, 404 when hidden, and lists the owner's own", async () => {
    expect(served("GET", ONE), `GET ${ONE} is served`).toBeTypeOf("function");
    const { h, owner, save } = await load();
    const a = (await save(owner, { html: assetHtml(["Genesis 1:1-5"]), sourceUrl: "https://example.org/days.html" }))
      .json as Saved;
    await save(owner, { html: assetHtml(["Genesis 1:1-5"], { title: "Second" }), assetId: a.asset.id });
    const r = await h.call("GET", `/api/v1/claude-assets/${a.asset.id}`);
    const got = r.json as Asset;
    expect([r.status, got.title, got.sourceUrl, got.versions.map((v) => v.n), got.author.name, got.author.verified]).toEqual([
      200,
      "Second",
      "https://example.org/days.html",
      [1, 2],
      "Chana Author",
      false,
    ]);
    expect(got.author.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(r.json)).not.toContain(String(OWNER));
    await h.sql("update assets set hidden = true where id = $1", [a.asset.id]);
    expect(code(await h.call("GET", `/api/v1/claude-assets/${a.asset.id}`))).toBe("404 asset.not_found");
    expect(code(await h.call("GET", `/api/v1/claude-assets/${MISSING}`))).toBe("404 asset.not_found");
    const mine = (await h.call("GET", SAVE, { token: owner })).json as { assets: (Asset & { hidden: boolean })[] };
    expect(mine.assets.map((x) => [x.id, x.hidden])).toEqual([[a.asset.id, true]]);
  });

  // @ac 060/AC-009
  it("deletes an asset with its versions and files for its owner only, and with its owner's account", async () => {
    expect(served("DELETE", ONE), `DELETE ${ONE} is served`).toBeTypeOf("function");
    const { h, owner, other, save } = await load();
    const a = (await save(owner, { html: assetHtml(["Genesis 1:1"]) })).json as Saved;
    await save(owner, { html: assetHtml(["Genesis 1:2"]), assetId: a.asset.id });
    expect((await files(a.asset.id)).length).toBe(2);
    expect(code(await h.call("DELETE", `/api/v1/claude-assets/${a.asset.id}`, { token: other }))).toBe("404 asset.not_found");
    expect((await h.call("DELETE", `/api/v1/claude-assets/${a.asset.id}`, { token: owner })).status).toBe(204);
    expect(await h.sql("select count(*)::int as n from asset_versions")).toEqual([{ n: 0 }]);
    expect(await files(a.asset.id)).toEqual([]);

    const b = (await save(other, { html: assetHtml(["Genesis 1:3"]) })).json as Saved;
    expect((await files(b.asset.id)).length).toBe(1);
    const event = JSON.stringify({
      event: "user.deleted",
      id: "evt-assets-1",
      occurred_at: "2026-11-27T01:02:03Z",
      user_id: OTHER,
    });
    expect((await h.webhook(event)).status).toBe(200);
    expect(await h.sql("select count(*)::int as n from assets")).toEqual([{ n: 0 }]);
    expect(await files(b.asset.id)).toEqual([]);
  });
});
