// Acceptance tests for spec 063 AC-001 to AC-004 (a shiur with recordings and pinned Claude assets), L2: real Postgres
// through the route tree, Sefaria's expansion faked by its HTTP surface.
// @feature SHIUR-012 A shiur that holds recordings and pinned Claude asset versions
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import { assetHtml, startFakeSefaria, type FakeSefaria } from "../../test/integration/fake-sefaria";

const SHIURIM = "/api/v1/shiurim";
const ONE = "/api/v1/shiurim/$shiurId";
const PIN = "/api/v1/shiurim/$shiurId/assets";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Saved = { asset: { id: string }; version: { id: string; n: number } };
type ShiurAsset = {
  assetId: string;
  versionId: string;
  n: number;
  title: string;
  refs: string[];
  firstRef: string;
  contentUrl: string;
  shiurUrl: string | null;
};
type Shiur = {
  id: string;
  title: string;
  visibility: string;
  owner: { name: string; profileId: string | null };
  recordings: { id: string }[];
  assets: ShiurAsset[];
};
const code = (r: { status: number; json: unknown }) =>
  `${r.status} ${(r.json as { error?: { code: string } } | null)?.error?.code ?? ""}`.trim();
const U = 964001;
const V = 964002;
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

let sefaria: FakeSefaria;
beforeAll(async () => {
  sefaria = await startFakeSefaria();
});
afterAll(async () => {
  await sefaria.close();
  delete process.env.ASSET_CONTENT_SECRET;
});

async function load() {
  process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-shiurim-"));
  process.env.SEFARIA_API_ORIGIN = sefaria.origin;
  process.env.ASSET_CONTENT_ORIGIN = "http://social.test";
  process.env.ASSET_CONTENT_SECRET = "integration-test-asset-content-secret";
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const u = await h.token(U, { name: "Rav U" });
  const v = await h.token(V, { name: "Rav V" });
  const save = async (token: string, refs: string[], extra: Record<string, unknown> = {}, title?: string) =>
    (await h.call("POST", "/api/v1/claude-assets", { token, body: { html: assetHtml(refs, { title }), ...extra } }))
      .json as Saved;
  // U's ready recording R (in U's room), V's recording.
  const room = (await h.call("POST", "/api/v1/rooms", { token: u, body: { title: "U's room" } })).json as { id: string };
  const [rec] = await h.sql<{ id: string }>(
    "insert into session_recordings (room_id, owner_user_id, title, status) values ($1, $2, 'Week 1', 'ready') returning id",
    [room.id, U],
  );
  const [vrec] = await h.sql<{ id: string }>(
    "insert into session_recordings (room_id, owner_user_id, title, status) values ($1, $2, 'V week', 'ready') returning id",
    [room.id, V],
  );
  const a1 = await save(u, ["Genesis 1:1-5"], {}, "A one");
  const a2 = await save(u, ["Genesis 1:1-5"], { assetId: a1.asset.id }, "A two");
  const b = await save(v, ["Genesis 2:1-3"], {}, "B");
  const c = await save(v, ["Genesis 3:1"], {}, "C");
  await h.sql("update profiles set verified = true where user_id = $1", [V]);
  await h.call("POST", `/api/v1/claude-assets/${b.asset.id}/publish`, { token: v, body: {} });
  return { h, u, v, save, recording: rec!.id, vRecording: vrec!.id, a1, a2, b, c };
}

describe("spec 063: shiurim with pinned assets", () => {
  // @ac 063/AC-001
  it("creates a shiur with the owner's recording, unlisted by default, and lists it; refuses another's recording", async () => {
    expect(served("POST", SHIURIM), `POST ${SHIURIM} is served`).toBeTypeOf("function");
    const { h, u, recording, vRecording } = await load();
    const r = await h.call("POST", SHIURIM, { token: u, body: { title: "Bereshit", recordingId: recording } });
    const s = r.json as Shiur;
    expect([r.status, s.title, s.visibility, s.recordings.map((x) => x.id), s.owner.name]).toEqual([
      201,
      "Bereshit",
      "unlisted",
      [recording],
      "Rav U",
    ]);
    const mine = (await h.call("GET", SHIURIM, { token: u })).json as { shiurim: Shiur[] };
    expect(mine.shiurim.map((x) => x.id)).toEqual([s.id]);
    const before = await h.sql("select count(*)::int as n from shiurim");
    expect(code(await h.call("POST", SHIURIM, { token: u, body: { title: "Not mine", recordingId: vRecording } }))).toBe(
      "404 recording.not_found",
    );
    expect(await h.sql("select count(*)::int as n from shiurim")).toEqual(before);
  });

  // @ac 063/AC-002
  it("answers an unlisted shiur to anyone with its recordings and pinned assets; private and unknown are 404", async () => {
    expect(served("GET", ONE), `GET ${ONE} is served`).toBeTypeOf("function");
    const { h, u, recording, a1 } = await load();
    const s = (await h.call("POST", SHIURIM, { token: u, body: { title: "Bereshit", recordingId: recording } })).json as Shiur;
    await h.call("POST", `/api/v1/shiurim/${s.id}/assets`, {
      token: u,
      body: { assetId: a1.asset.id, versionId: a1.version.id },
    });
    const r = await h.call("GET", `/api/v1/shiurim/${s.id}`);
    const got = r.json as Shiur;
    expect([r.status, got.title, got.owner.name, got.recordings.map((x) => x.id)]).toEqual([
      200,
      "Bereshit",
      "Rav U",
      [recording],
    ]);
    expect(got.owner.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(got.assets.map((x) => [x.assetId, x.versionId, x.n, x.title, x.refs, x.firstRef, x.contentUrl])).toEqual([
      [
        a1.asset.id,
        a1.version.id,
        1,
        "A one",
        ["Genesis 1:1-5"],
        "Genesis 1:1-5",
        `http://social.test/api/v1/claude-assets/content/${a1.version.id}`,
      ],
    ]);
    expect(got.assets[0]!.shiurUrl).toMatch(
      new RegExp(`^http://social\\.test/api/v1/claude-assets/content/${a1.version.id}/shiur/`),
    );
    const priv = (await h.call("POST", SHIURIM, { token: u, body: { title: "Mine", visibility: "private" } })).json as Shiur;
    expect([
      code(await h.call("GET", `/api/v1/shiurim/${priv.id}`)),
      code(await h.call("GET", `/api/v1/shiurim/${MISSING}`)),
    ]).toEqual(["404 shiur.not_found", "404 shiur.not_found"]);
    await h.sql("update assets set hidden = true where id = $1", [a1.asset.id]);
    expect(((await h.call("GET", `/api/v1/shiurim/${s.id}`)).json as Shiur).assets).toEqual([]);
  });

  // @ac 063/AC-003
  it("pins, moves and removes assets for the shiur's owner, only versions they may pin", async () => {
    expect(served("POST", PIN), `POST ${PIN} is served`).toBeTypeOf("function");
    const { h, u, v, a1, a2, b, c } = await load();
    const s = (await h.call("POST", SHIURIM, { token: u, body: { title: "S" } })).json as Shiur;
    const pin = (body: Record<string, unknown>, token = u) => h.call("POST", `/api/v1/shiurim/${s.id}/assets`, { token, body });
    const pins = (r: { json: unknown }) => (r.json as Shiur).assets.map((x) => [x.assetId, x.n]);
    expect(pins(await pin({ assetId: a1.asset.id }))).toEqual([[a1.asset.id, 2]]);
    expect(pins(await pin({ assetId: a1.asset.id, versionId: a1.version.id }))).toEqual([[a1.asset.id, 1]]);
    expect(pins(await pin({ assetId: b.asset.id }))).toEqual([
      [a1.asset.id, 1],
      [b.asset.id, 1],
    ]);
    const refused = [
      code(await pin({ assetId: c.asset.id })),
      code(await pin({ assetId: b.asset.id, versionId: a2.version.id })),
      code(await pin({ assetId: MISSING })),
      code(await pin({ assetId: b.asset.id }, v)),
    ];
    expect(refused).toEqual(["404 asset.not_found", "404 asset.not_found", "404 asset.not_found", "404 shiur.not_found"]);
    const removed = await h.call("DELETE", `/api/v1/shiurim/${s.id}/assets/${a1.asset.id}`, { token: u });
    expect(pins(removed)).toEqual([[b.asset.id, 1]]);
    expect(code(await h.call("DELETE", `/api/v1/shiurim/${s.id}/assets/${a1.asset.id}`, { token: u }))).toBe(
      "404 asset.not_found",
    );
  });

  // @ac 063/AC-004
  it("keeps answering the pinned version after the author saves a newer one", async () => {
    expect(served("POST", PIN), `POST ${PIN} is served`).toBeTypeOf("function");
    const { h, u, save, a1 } = await load();
    const s = (await h.call("POST", SHIURIM, { token: u, body: { title: "S" } })).json as Shiur;
    await h.call("POST", `/api/v1/shiurim/${s.id}/assets`, {
      token: u,
      body: { assetId: a1.asset.id, versionId: a1.version.id },
    });
    const v3 = await save(u, ["Genesis 1:1-5"], { assetId: a1.asset.id }, "A three");
    expect(v3.version.n).toBe(3);
    const got = ((await h.call("GET", `/api/v1/shiurim/${s.id}`)).json as Shiur).assets[0]!;
    expect([got.versionId, got.n, got.title, got.contentUrl]).toEqual([
      a1.version.id,
      1,
      "A one",
      `http://social.test/api/v1/claude-assets/content/${a1.version.id}`,
    ]);
  });
});
