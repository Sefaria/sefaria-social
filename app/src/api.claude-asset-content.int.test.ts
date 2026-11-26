// Acceptance tests for spec 061 (serving a Claude asset's file), L2: real Postgres through the route tree, a fresh object
// store, Sefaria's expansion faked by its HTTP surface. The test requests come in on http://social.test, so the content
// origin is set to it except where a test proves the origin check.
// @feature SHIUR-010 Claude asset content served sandboxed from its own origin
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import { resetConfig } from "~/server/config";
import type * as FakeSefariaModule from "../../test/integration/fake-sefaria";

// Loaded through import.meta.glob: on a base without it, each test fails on its first assertion (prove-red).
const fakeModules = import.meta.glob<typeof FakeSefariaModule>("../../test/integration/fake-sefaria.ts");
type FakeSefaria = FakeSefariaModule.FakeSefaria;
let assetHtml: typeof FakeSefariaModule.assetHtml;

const CONTENT = "/api/v1/claude-assets/content/$versionId";
const SHIUR_CONTENT = "/api/v1/claude-assets/content/$versionId/shiur/$grant";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Version = { id: string; contentUrl: string };
type Saved = { asset: { id: string; versions: Version[] }; version: Version };
type Shiur = { id: string; assets: { versionId: string; contentUrl: string; shiurUrl: string | null }[] };
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
const SECRET = "integration-test-asset-content-secret";

let sefaria: FakeSefaria;
beforeAll(async () => {
  const m = await fakeModules["../../test/integration/fake-sefaria.ts"]?.();
  if (!m) return; // the base: every test fails on its first assertion
  assetHtml = m.assetHtml;
  sefaria = await m.startFakeSefaria();
});
afterAll(async () => {
  await sefaria?.close();
  for (const k of ["ASSET_CONTENT_ORIGIN", "ASSET_CONTENT_SECRET", "ASSET_TRUSTED_CDNS_ENABLED", "SOCIAL_ALLOWED_ORIGINS"])
    delete process.env[k];
  resetConfig();
});

async function load() {
  process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-content-"));
  process.env.SEFARIA_API_ORIGIN = sefaria?.origin ?? "http://127.0.0.1:9";
  process.env.ASSET_CONTENT_ORIGIN = "http://social.test";
  process.env.ASSET_CONTENT_SECRET = SECRET;
  process.env.SOCIAL_ALLOWED_ORIGINS = "https://www.sefaria.org,https://sefaria.org.il";
  delete process.env.ASSET_TRUSTED_CDNS_ENABLED;
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const owner = await h.token(962001, { name: "Content Author" });
  const html = assetHtml(["Genesis 1:1-5"]);
  const saved = (await h.call("POST", "/api/v1/claude-assets", { token: owner, body: { html } })).json as Saved;
  const pathOf = (url: string) => new URL(url).pathname;
  return { h, owner, html, saved, pathOf };
}

const csp = (r: { headers: Headers }) => r.headers.get("content-security-policy") ?? "";
const directives = (policy: string) => Object.fromEntries(policy.split(/;\s*/).map((d) => [d.split(" ")[0], d]));

describe("spec 061: serving a Claude asset's file", () => {
  // @ac 061/AC-001
  it("answers the public URL sandboxed, framed only by the reader's origins, with no network", async () => {
    expect(served("GET", CONTENT), `GET ${CONTENT} is served`).toBeTypeOf("function");
    const { h, html, saved, pathOf } = await load();
    const r = await h.call("GET", pathOf(saved.version.contentUrl));
    expect([r.status, new TextDecoder().decode(r.bytes), r.headers.get("content-type")]).toEqual([
      200,
      html,
      "text/html; charset=utf-8",
    ]);
    expect([r.headers.get("x-content-type-options"), r.headers.get("referrer-policy")]).toEqual(["nosniff", "no-referrer"]);
    const policy = csp(r);
    expect(policy.startsWith("sandbox allow-scripts;")).toBe(true);
    const d = directives(policy);
    expect([d["frame-ancestors"], d["default-src"], d["script-src"], d["style-src"], d["img-src"], d["connect-src"]]).toEqual([
      "frame-ancestors https://www.sefaria.org https://sefaria.org.il",
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      undefined,
    ]);
  });

  // @ac 061/AC-002
  it("adds the trusted CDNs only while the switch is on", async () => {
    expect(served("GET", CONTENT), `GET ${CONTENT} is served`).toBeTypeOf("function");
    const { h, saved, pathOf } = await load();
    const off = csp(await h.call("GET", pathOf(saved.version.contentUrl)));
    expect(off).not.toContain("cdnjs.cloudflare.com");
    process.env.ASSET_TRUSTED_CDNS_ENABLED = "true";
    resetConfig();
    const d = directives(csp(await h.call("GET", pathOf(saved.version.contentUrl))));
    const hosts =
      "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com";
    expect([d["script-src"], d["style-src"], d["font-src"], d["connect-src"]]).toEqual([
      `script-src 'unsafe-inline' ${hosts}`,
      `style-src 'unsafe-inline' ${hosts}`,
      `font-src data: ${hosts}`,
      undefined,
    ]);
  });

  // @ac 061/AC-003
  it("serves a pinned version open at its signed shiur URL, and refuses a changed, foreign, expired or unpinned grant", async () => {
    expect(served("GET", SHIUR_CONTENT), `GET ${SHIUR_CONTENT} is served`).toBeTypeOf("function");
    const { h, owner, html, saved, pathOf } = await load();
    const shiur = (await h.call("POST", "/api/v1/shiurim", { token: owner, body: { title: "Bereshit" } })).json as Shiur;
    const pinned = (
      await h.call("POST", `/api/v1/shiurim/${shiur.id}/assets`, { token: owner, body: { assetId: saved.asset.id } })
    ).json as Shiur;
    const url = pinned.assets[0]!.shiurUrl!;
    const r = await h.call("GET", pathOf(url));
    expect([r.status, new TextDecoder().decode(r.bytes)]).toEqual([200, html]);
    const d = directives(csp(r));
    expect([csp(r).startsWith("sandbox allow-scripts;"), d["frame-ancestors"], d["connect-src"], d["default-src"]]).toEqual([
      true,
      "frame-ancestors https://www.sefaria.org https://sefaria.org.il",
      "connect-src *",
      "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    ]);

    const grant = url.split("/shiur/")[1]!;
    const [sid, exp, mac] = grant.split(".");
    const other = (await h.call("POST", "/api/v1/claude-assets", { token: owner, body: { html: assetHtml(["Genesis 2:1"]) } }))
      .json as Saved;
    const { shiurGrant } = await import("~/server/services/asset-content");
    const expired = shiurGrant(shiur.id, saved.version.id, Math.floor(Date.now() / 1000) - 3600)!;
    const tries = [
      `${sid}.${exp}.${mac!.slice(0, -2)}AA`,
      `${sid}.${Number(exp) + 60}.${mac}`,
      `/api/v1/claude-assets/content/${other.version.id}/shiur/${grant}`,
      expired,
    ].map((g) => (g.startsWith("/") ? g : `/api/v1/claude-assets/content/${saved.version.id}/shiur/${g}`));
    const statuses = [];
    for (const t of tries) statuses.push((await h.call("GET", t)).status);
    expect(statuses).toEqual([404, 404, 404, 404]);
    await h.call("DELETE", `/api/v1/shiurim/${shiur.id}/assets/${saved.asset.id}`, { token: owner });
    expect((await h.call("GET", pathOf(url))).status, "no longer pinned").toBe(404);
  });

  // @ac 061/AC-004
  it("answers content only on the content origin, and builds every contentUrl on it", async () => {
    expect(served("GET", CONTENT), `GET ${CONTENT} is served`).toBeTypeOf("function");
    const { h, saved, pathOf } = await load();
    process.env.ASSET_CONTENT_ORIGIN = "https://assets.example.test";
    resetConfig();
    expect((await h.call("GET", pathOf(saved.version.contentUrl))).status).toBe(404);
    const again = (await h.call("GET", `/api/v1/claude-assets/${saved.asset.id}`)).json as Saved["asset"];
    expect(again.versions.map((v) => v.contentUrl)).toEqual([
      `https://assets.example.test/api/v1/claude-assets/content/${saved.version.id}`,
    ]);
  });

  // @ac 061/AC-005
  it("caches the public URL briefly and the shiur URL privately, and answers 404 once hidden, deleted or unknown", async () => {
    expect(served("GET", CONTENT), `GET ${CONTENT} is served`).toBeTypeOf("function");
    const { h, owner, saved, pathOf } = await load();
    const shiur = (await h.call("POST", "/api/v1/shiurim", { token: owner, body: { title: "S" } })).json as Shiur;
    const pinned = (
      await h.call("POST", `/api/v1/shiurim/${shiur.id}/assets`, { token: owner, body: { assetId: saved.asset.id } })
    ).json as Shiur;
    const pub = pathOf(saved.version.contentUrl);
    const priv = pathOf(pinned.assets[0]!.shiurUrl!);
    expect([
      (await h.call("GET", pub)).headers.get("cache-control"),
      (await h.call("GET", priv)).headers.get("cache-control"),
    ]).toEqual(["public, max-age=300", "private, max-age=300"]);
    await h.sql("update assets set hidden = true where id = $1", [saved.asset.id]);
    const hidden = [(await h.call("GET", pub)).status, (await h.call("GET", priv)).status];
    await h.sql("update assets set hidden = false where id = $1", [saved.asset.id]);
    await h.call("DELETE", `/api/v1/claude-assets/${saved.asset.id}`, { token: owner });
    const deleted = [(await h.call("GET", pub)).status, (await h.call("GET", priv)).status];
    const unknown = (await h.call("GET", `/api/v1/claude-assets/content/${MISSING}`)).status;
    expect([hidden, deleted, unknown]).toEqual([[404, 404], [404, 404], 404]);
  });

  // @ac 061/AC-006
  it("gives every version its public contentUrl in reads and saves", async () => {
    expect(served("GET", CONTENT), `GET ${CONTENT} is served`).toBeTypeOf("function");
    const { h, owner, saved } = await load();
    const v2 = (
      await h.call("POST", "/api/v1/claude-assets", {
        token: owner,
        body: { html: assetHtml(["Genesis 1:1-5"], { title: "Two" }), assetId: saved.asset.id },
      })
    ).json as Saved;
    const read = (await h.call("GET", `/api/v1/claude-assets/${saved.asset.id}`)).json as Saved["asset"];
    const want = (id: string) => `http://social.test/api/v1/claude-assets/content/${id}`;
    expect([saved.version.contentUrl, v2.version.contentUrl, read.versions.map((v) => v.contentUrl)]).toEqual([
      want(saved.version.id),
      want(v2.version.id),
      [want(saved.version.id), want(v2.version.id)],
    ]);
  });
});
