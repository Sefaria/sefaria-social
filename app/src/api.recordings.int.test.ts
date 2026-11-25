// Acceptance tests for spec 041, server side: a room's owner records its session; the server keeps media chunks and state
// batches in order, finishes or finalises the recording, and serves it back to the room's members (L2, real Postgres), through
// the route tree, with a local server playing LiveKit's RoomService (Twirp) for the room metadata. Each test first asserts its
// route is served, so on a base without the feature it fails on that assertion.
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const ROOM_RECORDINGS = "/api/v1/rooms/$roomId/recordings";
const RECORDING = "/api/v1/recordings/$recordingId";
const MEDIA_CHUNK = "/api/v1/recordings/$recordingId/media/$seq";
const MEDIA = "/api/v1/recordings/$recordingId/media";
const STATE = "/api/v1/recordings/$recordingId/state";
const FINISH = "/api/v1/recordings/$recordingId/finish";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== path) return undefined;
  return r.options?.server?.handlers?.[method];
}

type Room = { id: string; recording?: boolean };
type Recording = {
  id: string;
  roomId: string;
  title: string | null;
  status: string;
  mime: string | null;
  startedAt: string;
  durationMs: number | null;
  mediaBytes: number;
  stateMessages: number;
  owner: { userId: number; name: string | null };
  canDelete: boolean;
};
type ErrorJson = { error: { code: string } };

const OWNER = 920001;
const DANA = 920002;
const STRANGER = 920003;
const MIME = "video/webm;codecs=vp8,opus";
const MISSING = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

const keyframe = (seq: number, t: number, url = "/Genesis.1.1") => ({
  type: "keyframe",
  seq,
  t,
  snapshot: { v: 1, url, slices: {} },
});
const change = (seq: number, t: number, url: string) => ({ type: "change", seq, t, change: { url } });
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

/** LiveKit's RoomService: records every call; UpdateRoomMetadata succeeds. */
async function fakeLivekit() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const method = req.url?.split("/").pop() ?? "";
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      calls.push({ method, body });
      const json = (status: number, v: unknown) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
      if (method === "UpdateRoomMetadata") return json(200, { name: body.room, metadata: body.metadata });
      return json(404, { code: "bad_route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const lk = await fakeLivekit();
  process.env.LIVEKIT_URL = lk.url;
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = async () => {
    delete process.env.RECORDINGS_ENABLED;
    resetConfig();
    await lk.close();
  };
  const owner = await h.token(OWNER, { name: "Avi Owner" });
  const dana = await h.token(DANA, { name: "Dana" });
  const stranger = await h.token(STRANGER, { name: "Stranger" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Recorded shiur" } })).json as Room;
  await h.call("POST", `/api/v1/rooms/${room.id}/members`, { token: dana });
  const start = async (roomId = room.id, token = owner) =>
    h.call("POST", `/api/v1/rooms/${roomId}/recordings`, { token, body: { mime: MIME } });
  const putChunk = (id: string, seq: number, bytes: Uint8Array, token = owner) =>
    h.call("PUT", `/api/v1/recordings/${id}/media/${seq}`, { token, bytes });
  const postState = (id: string, messages: unknown[], token = owner) =>
    h.call("POST", `/api/v1/recordings/${id}/state`, { token, body: { messages } });
  return { h, lk, owner, dana, stranger, room, start, putChunk, postState, resetConfig };
}

describe("spec 041: session recordings on the server", () => {
  // @feature API-049 Recordings API: start, upload, list, read and delete a session recording
  // @ac 041/AC-001
  it("lets only the room's owner start one recording at a time, and refuses when recordings are off", async () => {
    expect(served("POST", ROOM_RECORDINGS), `POST ${ROOM_RECORDINGS} is served`).toBeTypeOf("function");
    const { h, owner, dana, stranger, room, start, resetConfig } = await setup();

    expect(code(await start(room.id, dana)), "a member who is not the owner").toBe("403 room.forbidden");
    expect(code(await start(room.id, stranger)), "a non-member").toBe("404 room.not_found");
    expect(code(await start(MISSING, owner)), "an unknown room").toBe("404 room.not_found");

    const res = await start();
    expect(res.status).toBe(201);
    const rec = res.json as Recording;
    expect(rec).toMatchObject({
      roomId: room.id,
      title: "Recorded shiur",
      status: "recording",
      mime: MIME,
      durationMs: null,
      mediaBytes: 0,
      stateMessages: 0,
      owner: { userId: OWNER, name: "Avi Owner" },
      canDelete: true,
    });
    expect(rec.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(code(await start()), "a second while one is recording").toBe("409 recording.already_running");
    expect(await h.sql("select count(*)::int as n from session_recordings")).toEqual([{ n: 1 }]);

    process.env.RECORDINGS_ENABLED = "false";
    resetConfig();
    const other = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Another" } })).json as Room;
    expect(code(await start(other.id)), "recordings switched off").toBe("503 recording.unavailable");
    expect(await h.sql("select count(*)::int as n from session_recordings")).toEqual([{ n: 1 }]);
  });

  // @feature API-049 Recordings API: start, upload, list, read and delete a session recording
  // @ac 041/AC-002
  it("stores media chunks and state batches in order, from the recorder only, and stores nothing it refuses", async () => {
    expect(served("PUT", MEDIA_CHUNK), `PUT ${MEDIA_CHUNK} is served`).toBeTypeOf("function");
    expect(served("POST", STATE), `POST ${STATE} is served`).toBeTypeOf("function");
    const { h, owner, dana, stranger, start, putChunk, postState } = await setup();
    const rec = (await start()).json as Recording;

    expect((await putChunk(rec.id, 0, new Uint8Array([1, 2, 3]))).status).toBe(204);
    expect((await putChunk(rec.id, 1, new Uint8Array([4, 5]))).status).toBe(204);
    expect(code(await putChunk(rec.id, 3, new Uint8Array([9]))), "a gap").toBe("409 recording.out_of_order");
    expect(code(await putChunk(rec.id, 1, new Uint8Array([9]))), "a repeat").toBe("409 recording.out_of_order");
    expect((await putChunk(rec.id, 1, new Uint8Array([4, 5]))).status, "the last chunk sent again (a retry)").toBe(204);
    expect(code(await putChunk(rec.id, 2, new Uint8Array([9]), dana)), "a member").toBe("403 recording.forbidden");
    expect(code(await putChunk(rec.id, 2, new Uint8Array([9]), stranger)), "a non-member").toBe("404 recording.not_found");
    expect(code(await putChunk(rec.id, 2, new Uint8Array(4 * 1024 * 1024 + 1))), "over 4 MB").toBe("413 request.too_large");
    expect(code(await putChunk(MISSING, 0, new Uint8Array([1]))), "an unknown recording").toBe("404 recording.not_found");
    expect(
      await h.sql<{ seq: number; hex: string }>(
        "select seq, encode(bytes, 'hex') as hex from recording_media_chunks order by seq",
      ),
    ).toEqual([
      { seq: 0, hex: "010203" },
      { seq: 1, hex: "0405" },
    ]);

    const ok = await postState(rec.id, [keyframe(0, 0), change(1, 1500, "/Genesis.1.2")]);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ stored: 2 });
    expect(code(await postState(rec.id, [change(2, 2000, "/Genesis.1.3"), { type: "change", seq: 3 }])), "bad message").toBe(
      "400 request.invalid",
    );
    expect(code(await postState(rec.id, [change(4, 2000, "/Genesis.1.3")])), "seq does not continue").toBe(
      "409 recording.out_of_order",
    );
    expect(code(await postState(rec.id, [change(2, 2000, "/a"), change(4, 2100, "/b")])), "seq skips inside").toBe(
      "409 recording.out_of_order",
    );
    expect(code(await postState(rec.id, [change(2, 2000, "/Genesis.1.3")], dana)), "a member").toBe("403 recording.forbidden");
    expect((await postState(rec.id, [change(2, 2000, "/Genesis.1.3")])).status).toBe(200);
    expect(
      await h.sql("select first_seq, last_seq, jsonb_array_length(messages) as n from recording_state_chunks order by 1"),
    ).toEqual([
      { first_seq: 0, last_seq: 1, n: 2 },
      { first_seq: 2, last_seq: 2, n: 1 },
    ]);
    expect(await h.sql("select media_bytes, state_messages from session_recordings")).toEqual([
      { media_bytes: "5", state_messages: 3 },
    ]);

    expect(
      (await h.call("POST", `/api/v1/recordings/${rec.id}/finish`, { token: owner, body: { durationMs: 3000 } })).status,
    ).toBe(200);
    expect(code(await putChunk(rec.id, 2, new Uint8Array([7]))), "after finish").toBe("409 recording.not_recording");
    expect(code(await postState(rec.id, [change(3, 3000, "/Genesis.1.4")])), "state after finish").toBe(
      "409 recording.not_recording",
    );
    expect(await h.sql("select count(*)::int as n from recording_media_chunks")).toEqual([{ n: 2 }]);
    expect(await h.sql("select count(*)::int as n from recording_state_chunks")).toEqual([{ n: 2 }]);
  });

  // @feature API-049 Recordings API: start, upload, list, read and delete a session recording
  // @ac 041/AC-003
  it("finishes a recording with the recorder's duration, and finalises or drops one left without uploads", async () => {
    expect(served("POST", FINISH), `POST ${FINISH} is served`).toBeTypeOf("function");
    const { h, owner, dana, start, putChunk, postState } = await setup();
    const first = (await start()).json as Recording;
    await putChunk(first.id, 0, new Uint8Array([1]));
    const finish = (id: string, token = owner) =>
      h.call("POST", `/api/v1/recordings/${id}/finish`, { token, body: { durationMs: 12345 } });
    expect(code(await finish(first.id, dana)), "only the recorder finishes").toBe("403 recording.forbidden");
    const done = await finish(first.id);
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ id: first.id, status: "ready", durationMs: 12345 });
    expect(code(await finish(first.id)), "finished already").toBe("409 recording.not_recording");

    // Abandoned after some state: ready on the next read, its duration the last state message's t.
    const stale = (await start()).json as Recording;
    await postState(stale.id, [keyframe(0, 0), change(1, 4321, "/Genesis.2.1")]);
    await h.sql("update session_recordings set last_upload_at = now() - interval '3 minutes' where id = $1", [stale.id]);
    const read = await h.call("GET", `/api/v1/recordings/${stale.id}`, { token: dana });
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ id: stale.id, status: "ready", durationMs: 4321 });

    // Abandoned with nothing stored: deleted on the next read, and a new one may start.
    const empty = (await start()).json as Recording;
    await h.sql("update session_recordings set last_upload_at = now() - interval '3 minutes' where id = $1", [empty.id]);
    expect(code(await h.call("GET", `/api/v1/recordings/${empty.id}`, { token: owner }))).toBe("404 recording.not_found");
    expect(await h.sql("select count(*)::int as n from session_recordings where id = $1", [empty.id])).toEqual([{ n: 0 }]);
    expect((await start()).status).toBe(201);
  });

  // @feature API-049 Recordings API: start, upload, list, read and delete a session recording
  // @ac 041/AC-004
  it("lists a room's recordings newest first and serves the state track and the media to members only", async () => {
    expect(served("GET", MEDIA), `GET ${MEDIA} is served`).toBeTypeOf("function");
    expect(served("GET", ROOM_RECORDINGS), `GET ${ROOM_RECORDINGS} is served`).toBeTypeOf("function");
    const { h, owner, dana, stranger, room, start, putChunk, postState } = await setup();
    const older = (await start()).json as Recording;
    await putChunk(older.id, 0, new Uint8Array([0x1a, 0x45]));
    await putChunk(older.id, 1, new Uint8Array([0xdf, 0xa3]));
    await putChunk(older.id, 2, new Uint8Array([0x9f]));
    await postState(older.id, [keyframe(0, 0), change(1, 800, "/Genesis.1.2")]);
    await postState(older.id, [change(2, 1600, "/Genesis.1.3"), keyframe(3, 2400, "/Genesis.1.3")]);
    await h.call("POST", `/api/v1/recordings/${older.id}/finish`, { token: owner, body: { durationMs: 2500 } });
    await h.sql("update session_recordings set started_at = now() - interval '1 hour' where id = $1", [older.id]);
    const newer = (await start()).json as Recording;

    const list = await h.call("GET", `/api/v1/rooms/${room.id}/recordings`, { token: dana });
    expect(list.status).toBe(200);
    const recs = (list.json as { recordings: Recording[] }).recordings;
    expect(recs.map((r) => [r.id, r.status, r.durationMs, r.title, r.owner.name, r.canDelete])).toEqual([
      [newer.id, "recording", null, "Recorded shiur", "Avi Owner", false],
      [older.id, "ready", 2500, "Recorded shiur", "Avi Owner", false],
    ]);
    expect(Date.parse(recs[0]!.startedAt)).toBeGreaterThan(Date.parse(recs[1]!.startedAt));

    const state = await h.call("GET", `/api/v1/recordings/${older.id}/state`, { token: dana });
    expect(state.status).toBe(200);
    const { parseRecording } = await import("@sefaria-social/session");
    const parsed = parseRecording(state.json);
    expect(parsed, "the state track parses as the reader's Recording v1").not.toBeNull();
    expect(parsed!.client).toBe("sefaria-social");
    expect(parsed!.duration).toBe(2500);
    expect(parsed!.startedAt).toBe(recs[1]!.startedAt);
    expect(parsed!.messages.map((m) => [m.type, m.seq, m.t])).toEqual([
      ["keyframe", 0, 0],
      ["change", 1, 800],
      ["change", 2, 1600],
      ["keyframe", 3, 2400],
    ]);

    const media = await h.call("GET", `/api/v1/recordings/${older.id}/media`, { token: dana });
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe(MIME);
    expect(media.headers.get("cache-control")).toBe("no-store");
    expect([...media.bytes]).toEqual([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);

    for (const path of [
      `/api/v1/rooms/${room.id}/recordings`,
      `/api/v1/recordings/${older.id}`,
      `/api/v1/recordings/${older.id}/state`,
      `/api/v1/recordings/${older.id}/media`,
    ])
      expect(code(await h.call("GET", path, { token: stranger })), path).toMatch(/^404 (room|recording)\.not_found$/);
  });

  // @feature API-049 Recordings API: start, upload, list, read and delete a session recording
  // @ac 041/AC-005
  it("lets the recorder or the room's owner delete a recording with its chunks, and deletes a user's recordings with them", async () => {
    expect(served("DELETE", RECORDING), `DELETE ${RECORDING} is served`).toBeTypeOf("function");
    const { h, owner, dana, stranger, room, start, putChunk, postState } = await setup();
    const rec = (await start()).json as Recording;
    await putChunk(rec.id, 0, new Uint8Array([1, 2]));
    await postState(rec.id, [keyframe(0, 0)]);
    const del = (token: string) => h.call("DELETE", `/api/v1/recordings/${rec.id}`, { token });
    expect(code(await del(dana)), "a member").toBe("403 recording.forbidden");
    expect(code(await del(stranger)), "a non-member").toBe("404 recording.not_found");
    expect((await del(owner)).status).toBe(204);
    for (const table of ["session_recordings", "recording_media_chunks", "recording_state_chunks"])
      expect(await h.sql(`select count(*)::int as n from ${table}`), table).toEqual([{ n: 0 }]);

    // The account deletion: the owner's recordings go, with their chunks; the walk finds nothing for them.
    const kept = (await start()).json as Recording;
    await putChunk(kept.id, 0, new Uint8Array([3]));
    const elsewhere = (await h.call("POST", "/api/v1/rooms", { token: dana, body: { title: "Dana's room" } })).json as Room;
    await h.sql(
      "insert into session_recordings (room_id, owner_user_id, title, status) values ($1, $2, 'Recorded by the owner', 'ready')",
      [elsewhere.id, OWNER],
    );
    const body = JSON.stringify({
      event: "user.deleted",
      id: "evt-rec-owner",
      occurred_at: "2026-11-24T01:02:03Z",
      user_id: OWNER,
    });
    expect((await h.webhook(body)).status).toBe(200);
    expect(await h.sql("select count(*)::int as n from session_recordings where owner_user_id = $1", [OWNER])).toEqual([
      { n: 0 },
    ]);
    expect(await h.sql("select count(*)::int as n from recording_media_chunks")).toEqual([{ n: 0 }]);
    const walk = await import("../../test/integration/schema-walk");
    expect(await walk.userValues(h.sql, OWNER)).toEqual(["deleted_users.user_id: 1"]);
    expect(room.id).not.toBe(elsewhere.id);
  });

  // @feature SESS-064 Record a room's session (state and call media) in the owner's browser
  // @ac 041/AC-006
  it("says a room is being recorded in its read and status and in the call's metadata, and stops saying it after", async () => {
    expect(served("POST", ROOM_RECORDINGS), `POST ${ROOM_RECORDINGS} is served`).toBeTypeOf("function");
    const { h, lk, owner, dana, room, start } = await setup();
    const read = async () => (await h.call("GET", `/api/v1/rooms/${room.id}`, { token: dana })).json as Room;
    const status = async () =>
      (await h.call("GET", `/api/v1/rooms/${room.id}/status`, { token: dana })).json as { recording?: boolean };
    expect(await read()).not.toHaveProperty("recording");
    expect(await status()).not.toHaveProperty("recording");

    const rec = (await start()).json as Recording;
    expect((await read()).recording).toBe(true);
    expect((await status()).recording).toBe(true);
    const metadata = () => lk.calls.filter((c) => c.method === "UpdateRoomMetadata").map((c) => [c.body.room, c.body.metadata]);
    expect(metadata()).toEqual([[`room_${room.id}`, JSON.stringify({ recording: true })]]);

    await h.call("POST", `/api/v1/recordings/${rec.id}/finish`, { token: owner, body: { durationMs: 1000 } });
    expect(await read()).not.toHaveProperty("recording");
    expect(await status()).not.toHaveProperty("recording");
    expect(metadata()).toEqual([
      [`room_${room.id}`, JSON.stringify({ recording: true })],
      [`room_${room.id}`, JSON.stringify({ recording: false })],
    ]);
  });
});
