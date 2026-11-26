// Acceptance tests for spec 051, server side: a ready recording opens for anyone with its link, signed out included, and
// nothing only a member sees; media chunks live in the object store, not Postgres, and go when the recording, its room or its
// owner does; the migration dropped the media chunk table (L2, real Postgres, a fresh object store directory). Each test first
// asserts its route is served (or the table is gone), so on a base without the feature it fails on that assertion.
import { mkdtempSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const ASSET = "/api/v1/assets/$assetId";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const ASSET_DIR = mkdtempSync(path.join(tmpdir(), "social-assets-"));
process.env.ASSET_STORE_DIR = ASSET_DIR;

const OWNER = 951001;
const GUEST = 951002;
const MIME = "video/webm;codecs=vp8,opus";
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";
type ErrorJson = { error: { code: string } };
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

async function objects(recordingId: string): Promise<string[]> {
  try {
    return (await readdir(path.join(ASSET_DIR, "recordings", recordingId, "raw"))).filter((n) => !n.endsWith(".tmp")).sort();
  } catch {
    return [];
  }
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = () => resetConfig();
  const owner = await h.token(OWNER, { name: "Rav Leader" });
  const guest = await h.token(GUEST, { name: "Guest" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Shiur on Bereshit" } })).json as {
    id: string;
  };
  const start = async () =>
    (await h.call("POST", `/api/v1/rooms/${room.id}/recordings`, { token: owner, body: { mime: MIME } })).json as {
      id: string;
    };
  const chunk = (id: string, seq: number, bytes: Uint8Array) =>
    h.call("PUT", `/api/v1/recordings/${id}/media/${seq}`, { token: owner, bytes });
  const state = (id: string, messages: unknown[]) =>
    h.call("POST", `/api/v1/recordings/${id}/state`, { token: owner, body: { messages } });
  const finish = (id: string) => h.call("POST", `/api/v1/recordings/${id}/finish`, { token: owner, body: { durationMs: 4000 } });
  return { h, owner, guest, room, start, chunk, state, finish };
}

const keyframe = { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", slices: {} } };

describe("spec 051: the shiur asset on the server", () => {
  // @feature SHIUR-003 A ready recording opens for anyone with its link
  // @ac 051/AC-004
  it("serves a ready recording's asset, timeline and media to anyone, and nothing of one still recording", async () => {
    expect(served("GET", ASSET), `GET ${ASSET} is served`).toBeTypeOf("function");
    const { h, room, start, chunk, state, finish } = await setup();
    const rec = await start();
    await chunk(rec.id, 0, new Uint8Array([1, 2, 3]));
    await state(rec.id, [keyframe]);

    // Still recording: nothing for anyone without membership.
    expect(code(await h.call("GET", `/api/v1/assets/${rec.id}`)), "recording").toBe("404 recording.not_found");
    expect(code(await h.call("GET", `/api/v1/assets/${MISSING}`)), "unknown").toBe("404 recording.not_found");

    await finish(rec.id);
    const asset = await h.call("GET", `/api/v1/assets/${rec.id}`); // no token: signed out
    expect(asset.status).toBe(200);
    expect(asset.json).toEqual({
      id: rec.id,
      title: "Shiur on Bereshit",
      status: "ready",
      mime: MIME,
      startedAt: expect.any(String),
      durationMs: 4000,
      leader: { name: "Rav Leader" },
    });
    expect(JSON.stringify(asset.json), "no room id: the room's id is its invitation").not.toContain(room.id);
    const track = await h.call("GET", `/api/v1/assets/${rec.id}/state`);
    expect(track.status).toBe(200);
    expect((track.json as { messages: unknown[] }).messages).toHaveLength(1);
    const media = await h.call("GET", `/api/v1/assets/${rec.id}/media`);
    expect(media.status).toBe(200);
    expect(Buffer.from(media.bytes ?? new Uint8Array()).toString("hex")).toBe("010203");

    // A room's list of recordings still needs membership.
    expect((await h.call("GET", `/api/v1/rooms/${room.id}/recordings`)).status).toBe(401);
  });

  // @feature SHIUR-004 Recording media in an object store
  // @ac 051/AC-005
  it("keeps media chunks in the object store, only their count and last hash in Postgres, and removes them with the recording", async () => {
    expect(served("GET", ASSET), `GET ${ASSET} is served`).toBeTypeOf("function");
    const { h, owner, room, start, chunk, finish } = await setup();
    const rec = await start();
    expect((await chunk(rec.id, 0, new Uint8Array([1, 2]))).status).toBe(204);
    expect((await chunk(rec.id, 1, new Uint8Array([3]))).status).toBe(204);
    expect((await chunk(rec.id, 1, new Uint8Array([3]))).status, "a retry of the last chunk").toBe(204);
    expect(code(await chunk(rec.id, 1, new Uint8Array([9]))), "another chunk at the same seq").toBe("409 recording.out_of_order");
    expect(await objects(rec.id)).toEqual(["000000", "000001"]);
    expect(Buffer.from(await readFile(path.join(ASSET_DIR, "recordings", rec.id, "raw", "000001"))).toString("hex")).toBe("03");
    expect(await h.sql("select media_chunks, last_chunk_sha256 from session_recordings where id = $1", [rec.id])).toEqual([
      {
        media_chunks: 2,
        last_chunk_sha256: createHash("sha256")
          .update(new Uint8Array([3]))
          .digest("hex"),
      },
    ]);

    await finish(rec.id);
    expect((await h.call("DELETE", `/api/v1/recordings/${rec.id}`, { token: owner })).status).toBe(204);
    expect(await objects(rec.id), "deleting the recording removes its objects").toEqual([]);

    // A room's deletion takes its recordings' media too.
    const other = await start();
    await chunk(other.id, 0, new Uint8Array([7]));
    expect(await objects(other.id)).toEqual(["000000"]);
    expect((await h.call("DELETE", `/api/v1/rooms/${room.id}`, { token: owner })).status).toBe(204);
    expect(await objects(other.id), "deleting the room removes its recordings' objects").toEqual([]);
  });

  // @feature SHIUR-004 Recording media in an object store
  // @ac 051/AC-006
  it("dropped the media chunk table, after deleting the recordings made before", async () => {
    const { h } = await setup();
    expect(await h.sql("select table_name from information_schema.tables where table_name = 'recording_media_chunks'")).toEqual(
      [],
    );
    const { fileURLToPath } = await import("node:url");
    const sql = await readFile(
      fileURLToPath(new URL("./server/db/migrations/0009_shiur_asset_media.sql", import.meta.url)),
      "utf8",
    );
    expect(sql.indexOf('DELETE FROM "session_recordings"')).toBeGreaterThan(-1);
    expect(sql.indexOf('DELETE FROM "session_recordings"')).toBeLessThan(sql.indexOf('DROP TABLE "recording_media_chunks"'));
  });
});
