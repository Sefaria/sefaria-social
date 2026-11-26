// Acceptance tests for spec 062 (verified profiles, publish, the ref read API, takedown), L2: real Postgres through the route
// tree, the staff commands run with tsx like purge-user, Sefaria's expansion faked by its HTTP surface.
// @feature SHIUR-011 Publish a Claude asset to the segments it covers
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import type * as FakeSefariaModule from "../../test/integration/fake-sefaria";

// Loaded through import.meta.glob: on a base without it, each test fails on its first assertion (prove-red).
const fakeModules = import.meta.glob<typeof FakeSefariaModule>("../../test/integration/fake-sefaria.ts");
type FakeSefaria = FakeSefariaModule.FakeSefaria;
let assetHtml: typeof FakeSefariaModule.assetHtml;

const PUBLISH = "/api/v1/claude-assets/$assetId/publish";
const BY_REF = "/api/v1/claude-assets/ref/$ref";
const VERIFY = fileURLToPath(new URL("../scripts/verify-profile.ts", import.meta.url));
const TAKEDOWN = fileURLToPath(new URL("../scripts/asset-takedown.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const run = (script: string, args: string[]) =>
  spawnSync(TSX, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, LOG_LEVEL: "error" },
    timeout: 20_000,
  });

type Asset = { id: string; currentVersionId: string; publishedVersionId: string | null; versions: { id: string; n: number }[] };
type Saved = { asset: Asset; version: { id: string } };
type RefAsset = {
  id: string;
  title: string;
  description: string;
  author: { name: string; profileId: string; verified: boolean };
  anchorRefs: string[];
  refs: string[];
  versionId: string;
  contentUrl: string;
};
const code = (r: { status: number; json: unknown }) =>
  `${r.status} ${(r.json as { error?: { code: string } } | null)?.error?.code ?? ""}`.trim();
const OWNER = 963001;

let sefaria: FakeSefaria;
beforeAll(async () => {
  const m = await fakeModules["../../test/integration/fake-sefaria.ts"]?.();
  if (!m) return; // the base: every test fails on its first assertion
  assetHtml = m.assetHtml;
  sefaria = await m.startFakeSefaria();
});
afterAll(async () => {
  await sefaria?.close();
  delete process.env.SOCIAL_ALLOWED_ORIGINS;
});

async function load() {
  process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-publish-"));
  process.env.SEFARIA_API_ORIGIN = sefaria?.origin ?? "http://127.0.0.1:9";
  process.env.ASSET_CONTENT_ORIGIN = "http://social.test";
  process.env.SOCIAL_ALLOWED_ORIGINS = "https://www.sefaria.org";
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const owner = await h.token(OWNER, { name: "Chana Author" });
  const other = await h.token(963002, { name: "Other" });
  const me = (await h.call("GET", "/api/v1/profiles/me", { token: owner })).json as { id: string; handle: string };
  const saved = (
    await h.call("POST", "/api/v1/claude-assets", {
      token: owner,
      body: { html: assetHtml([{ ref: "Genesis 1:1-5", label: "Day one" }, "Genesis 1:6-8"]) },
    })
  ).json as Saved;
  const verify = (on = true) => h.sql("update profiles set verified = $2 where id = $1", [me.id, on]); // the command itself is proven in AC-001
  const publish = (token: string, body: Record<string, unknown> = {}) =>
    h.call("POST", `/api/v1/claude-assets/${saved.asset.id}/publish`, { token, body });
  const onRef = async (ref: string) =>
    (await h.call("GET", `/api/v1/claude-assets/ref/${encodeURIComponent(ref)}`)).json as { ref: string; assets: RefAsset[] };
  return { h, owner, other, me, saved, verify, publish, onRef };
}

describe("spec 062: verified profiles publish Claude assets", () => {
  // @feature IDENT-106 Verified profiles, granted by staff
  // @ac 062/AC-001
  it("lets staff verify a profile by id or handle from the command line, and remove the mark", async () => {
    expect(existsSync(VERIFY), "app/scripts/verify-profile.ts").toBe(true);
    const { h, owner, me } = await load();
    const on = run(VERIFY, [me.id, "--by", "staff-member"]);
    expect([on.status, on.stderr]).toEqual([0, ""]);
    expect(
      await h.sql("select verified, verified_by, verified_at is not null as at from profiles where id = $1", [me.id]),
    ).toEqual([{ verified: true, verified_by: "staff-member", at: true }]);
    const profile = (await h.call("GET", `/api/v1/profiles/${me.id}`, { token: owner })).json as {
      profile: { verified?: boolean };
    };
    const mine = (await h.call("GET", "/api/v1/profiles/me", { token: owner })).json as { verified?: boolean };
    expect([profile.profile.verified, mine.verified]).toEqual([true, true]);
    const unknown = run(VERIFY, ["@nobody_here_at_all", "--by", "staff-member"]);
    expect(unknown.status).toBe(1);
    const off = run(VERIFY, [`@${me.handle}`, "--off"]);
    expect(off.status).toBe(0);
    const after = (await h.call("GET", "/api/v1/profiles/me", { token: owner })).json as Record<string, unknown>;
    expect("verified" in after).toBe(false);
    expect(run(VERIFY, [me.id]).status, "--by is required").toBe(2);
  });

  // @ac 062/AC-002
  it("publishes only for a verified owner, indexing one row per covered segment", async () => {
    expect(served("POST", PUBLISH), `POST ${PUBLISH} is served`).toBeTypeOf("function");
    const { h, owner, other, saved, verify, publish } = await load();
    expect(code(await publish(owner))).toBe("403 asset.not_verified");
    expect(await h.sql("select published_version_id from assets")).toEqual([{ published_version_id: null }]);
    await verify();
    const ok = await publish(owner);
    expect([ok.status, (ok.json as Asset).publishedVersionId]).toEqual([200, saved.asset.currentVersionId]);
    const rows = await h.sql<{ segment_ref: string }>(
      "select segment_ref, section_ref, source_ref, label from asset_refs order by position",
    );
    expect(rows).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({
        segment_ref: `Genesis 1:${v}`,
        section_ref: "Genesis 1",
        source_ref: v <= 5 ? "Genesis 1:1-5" : "Genesis 1:6-8",
        label: v <= 5 ? "Day one" : null,
      })),
    );
    expect(code(await publish(other))).toBe("404 asset.not_found");
    const foreign = (await h.call("POST", "/api/v1/claude-assets", { token: other, body: { html: assetHtml(["Genesis 2:1"]) } }))
      .json as Saved;
    expect(code(await publish(owner, { versionId: foreign.version.id }))).toBe("404 asset.not_found");
  });

  // @ac 062/AC-003
  it("keeps the published version when a new one is saved, and unpublishes", async () => {
    expect(served("POST", PUBLISH), `POST ${PUBLISH} is served`).toBeTypeOf("function");
    const { h, owner, saved, verify, publish } = await load();
    await verify();
    await publish(owner);
    const v2 = (
      await h.call("POST", "/api/v1/claude-assets", {
        token: owner,
        body: { html: assetHtml(["Genesis 2:1"]), assetId: saved.asset.id },
      })
    ).json as Saved;
    expect([v2.asset.currentVersionId, v2.asset.publishedVersionId]).toEqual([v2.version.id, saved.version.id]);
    const off = await h.call("POST", `/api/v1/claude-assets/${saved.asset.id}/unpublish`, { token: owner });
    expect([off.status, (off.json as Asset).publishedVersionId]).toEqual([200, null]);
    expect(await h.sql("select count(*)::int as n from asset_refs")).toEqual([{ n: 0 }]);
  });

  // @feature API-053 Published Claude assets by ref, for the reader's sidebar
  // @ac 062/AC-004
  it("answers the assets on a section or segment, with anchor segments, cacheable and with CORS for the reader", async () => {
    expect(served("GET", BY_REF), `GET ${BY_REF} is served`).toBeTypeOf("function");
    const { h, owner, me, saved, verify, publish, onRef } = await load();
    await verify();
    await publish(owner);
    const section = await onRef("Genesis 1");
    expect(section).toEqual({
      ref: "Genesis 1",
      assets: [
        {
          id: saved.asset.id,
          title: "The Seven Days",
          description: "A scrolling story of creation, tied to Genesis 1.",
          author: { name: "Chana Author", profileId: me.id, verified: true },
          anchorRefs: [1, 2, 3, 4, 5, 6, 7, 8].map((v) => `Genesis 1:${v}`),
          refs: ["Genesis 1:1-5", "Genesis 1:6-8"],
          versionId: saved.version.id,
          contentUrl: `http://social.test/api/v1/claude-assets/content/${saved.version.id}`,
        },
      ],
    });
    expect((await onRef("Genesis 1:7")).assets.map((a) => a.anchorRefs)).toEqual([["Genesis 1:7"]]);
    expect([(await onRef("Exodus 1")).assets, (await onRef("Genesis 2:4")).assets]).toEqual([[], []]);
    const r = await h.call("GET", "/api/v1/claude-assets/ref/Genesis%201", { headers: { origin: "https://www.sefaria.org" } });
    expect([r.headers.get("cache-control"), r.headers.get("access-control-allow-origin")]).toEqual([
      "public, max-age=60",
      "https://www.sefaria.org",
    ]);
  });

  // @ac 062/AC-005
  it("lets staff take an asset down and restore it from the command line", async () => {
    expect(existsSync(TAKEDOWN), "app/scripts/asset-takedown.ts").toBe(true);
    const { h, owner, saved, verify, publish, onRef } = await load();
    await verify();
    await publish(owner);
    expect(run(TAKEDOWN, [saved.asset.id]).status).toBe(0);
    const gone = [
      (await onRef("Genesis 1")).assets.length,
      (await h.call("GET", `/api/v1/claude-assets/${saved.asset.id}`)).status,
      (await h.call("GET", `/api/v1/claude-assets/content/${saved.version.id}`)).status,
    ];
    const mine = (await h.call("GET", "/api/v1/claude-assets", { token: owner })).json as { assets: { hidden: boolean }[] };
    expect([gone, mine.assets.map((a) => a.hidden)]).toEqual([[0, 404, 404], [true]]);
    expect(run(TAKEDOWN, [saved.asset.id, "--restore"]).status).toBe(0);
    expect((await onRef("Genesis 1")).assets.map((a) => a.id)).toEqual([saved.asset.id]);
    expect(run(TAKEDOWN, ["6f1c2d3e-4b5a-4c6d-8e7f-001122334455"]).status).toBe(1);
  });

  // @ac 062/AC-006
  it("leaves a published asset out of the sidebar at once when its author's verification is removed", async () => {
    expect(served("GET", BY_REF), `GET ${BY_REF} is served`).toBeTypeOf("function");
    const { h, owner, me, saved, verify, publish, onRef } = await load();
    await verify();
    await publish(owner);
    expect(run(VERIFY, [me.id, "--off"]).status).toBe(0);
    const still = await h.sql("select published_version_id from assets where id = $1", [saved.asset.id]);
    expect([(await onRef("Genesis 1")).assets, still]).toEqual([[], [{ published_version_id: saved.version.id }]]);
    expect(run(VERIFY, [me.id, "--by", "staff-member"]).status).toBe(0);
    expect((await onRef("Genesis 1")).assets.map((a) => a.id)).toEqual([saved.asset.id]);
  });
});
