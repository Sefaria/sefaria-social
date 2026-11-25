// Acceptance tests for spec 054, server side: once a recording is processed its audio goes to Sofer.ai in the leader's language,
// the job polls until it is done and keeps the words with their times; without a key it is unavailable and playback works; a
// Sofer.ai failure is failed and never touches the asset (L2, real Postgres, real ffmpeg, a fake Sofer.ai on a local port that
// answers as its API documents). Each test first asserts its route is served, so on a base without the feature it fails there.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const TRANSCRIPT = "/api/v1/assets/$assetId/transcript";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const ASSET_DIR = mkdtempSync(path.join(tmpdir(), "social-assets-"));
process.env.ASSET_STORE_DIR = ASSET_DIR;
process.env.ASSET_WORKER = "off";

const WEBM = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), "social-webm-"));
  const out = path.join(dir, "t.webm");
  execFileSync("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...["-f", "lavfi", "-i", "testsrc=duration=4:size=160x120:rate=10"],
    ...["-f", "lavfi", "-i", "sine=duration=4"],
    ...["-c:v", "libvpx", "-b:v", "100k", "-c:a", "libopus", "-shortest", out],
  ]);
  return new Uint8Array(readFileSync(out));
})();

const OWNER = 954001;
const MIME = "video/webm;codecs=vp8,opus";
type ErrorJson = { error: { code: string } };
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

/** Sofer.ai as its API documents it: POST returns the id; /status says PROCESSING, then `finalStatus`; GET gives the words. */
async function fakeSofer(finalStatus = "COMPLETED") {
  const requests: { method: string; url: string; auth: string | undefined; body: Record<string, unknown> | null }[] = [];
  let polls = 0;
  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw));
    });
  const server = createServer((req, res) => {
    void body(req).then((raw) => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      const json = (v: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
      if (req.method === "POST" && req.url === "/v1/transcriptions/") return json("tx-1");
      if (req.url === "/v1/transcriptions/tx-1/status")
        return json({
          id: "tx-1",
          title: "t",
          created_at: "2026-11-26T00:00:00Z",
          status: polls++ === 0 ? "PROCESSING" : finalStatus,
        });
      if (req.url === "/v1/transcriptions/tx-1")
        return json({
          text: "Bereshit bara Elokim",
          timestamps: [
            { word: "בראשית", start: 0.2, end: 0.8 },
            { word: "ברא", start: 0.9, end: 1.3 },
            { word: "אלהים", start: 1.4, end: 2.1 },
          ],
          info: { id: "tx-1", title: "t", created_at: "2026-11-26T00:00:00Z", status: "COMPLETED" },
        });
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(opts: { key?: boolean; finalStatus?: string } = {}) {
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const sofer = await fakeSofer(opts.finalStatus);
  if (opts.key !== false) process.env.SOFER_API_KEY = "test-sofer-key";
  process.env.SOFER_API_URL = sofer.url;
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = async () => {
    delete process.env.SOFER_API_KEY;
    delete process.env.SOFER_API_URL;
    resetConfig();
    await sofer.close();
  };
  const process_ = await import("~/server/jobs/process-asset");
  const transcripts = await import("~/server/jobs/transcript");
  const owner = await h.token(OWNER, { name: "Rav Leader" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Transcribed shiur" } })).json as {
    id: string;
  };
  const record = async (language?: string) => {
    const rec = (
      await h.call("POST", `/api/v1/rooms/${room.id}/recordings`, {
        token: owner,
        body: { mime: MIME, ...(language ? { transcriptLanguage: language } : {}) },
      })
    ).json as { id: string };
    await h.call("PUT", `/api/v1/recordings/${rec.id}/media/0`, { token: owner, bytes: WEBM });
    await h.call("POST", `/api/v1/recordings/${rec.id}/state`, {
      token: owner,
      body: { messages: [{ type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.1", slices: {} } }] },
    });
    await h.call("POST", `/api/v1/recordings/${rec.id}/finish`, { token: owner, body: { durationMs: 4000 } });
    await process_.runPending();
    return rec.id;
  };
  const due = (id: string) => h.sql("update session_recordings set transcript_after = now() where id = $1", [id]);
  const status = async (id: string) =>
    (await h.sql<{ transcript_status: string | null }>("select transcript_status from session_recordings where id = $1", [id]))[0]
      ?.transcript_status;
  const manifest = async (id: string) =>
    (await h.call("GET", `/api/v1/assets/${id}/manifest`)).json as { transcript: { status: string; language?: string } };
  return { h, sofer, record, due, status, manifest, run: () => transcripts.runTranscripts() };
}

describe("spec 054: a shiur's transcript from Sofer.ai", () => {
  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-001
  // @ac 054/AC-002
  it("sends a processed shiur's audio in the leader's language, polls, and keeps the words with their times", async () => {
    expect(served("GET", TRANSCRIPT), `GET ${TRANSCRIPT} is served`).toBeTypeOf("function");
    const { h, sofer, record, due, status, manifest, run } = await setup();
    const id = await record();
    expect(await status(id)).toBe("queued");
    expect(code(await h.call("GET", `/api/v1/assets/${id}/transcript`))).toBe("404 recording.no_transcript");

    await run();
    expect(await status(id)).toBe("submitted");
    const post = sofer.requests.find((r) => r.method === "POST")!;
    expect(post.auth).toBe("Bearer test-sofer-key");
    expect(post.body?.info).toMatchObject({ primary_language: "en", hebrew_word_format: ["he"] });
    const audio = await readFile(path.join(ASSET_DIR, "recordings", id, "audio.m4a"));
    expect(post.body?.audio_file, "the audio, sent in the request without a public origin").toBe(audio.toString("base64"));
    expect((await manifest(id)).transcript.status).toBe("running");

    await due(id);
    await run(); // PROCESSING: still waiting, a little later
    expect(await status(id)).toBe("submitted");
    await due(id);
    await run(); // COMPLETED
    expect(await status(id)).toBe("ready");
    const transcript = (await h.call("GET", `/api/v1/assets/${id}/transcript`)).json as { language: string; words: unknown };
    expect(transcript.language).toBe("en");
    expect(transcript.words).toEqual([
      { w: "בראשית", s: 200, e: 800 },
      { w: "ברא", s: 900, e: 1300 },
      { w: "אלהים", s: 1400, e: 2100 },
    ]);
    expect(await readFile(path.join(ASSET_DIR, "recordings", id, "transcript.vtt"), "utf8")).toContain(
      "00:00:00.200 --> 00:00:02.100\nבראשית ברא אלהים",
    );
    expect((await manifest(id)).transcript).toMatchObject({ status: "ready", language: "en" });
  });

  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-003
  it("asks for the language the leader chose", async () => {
    expect(served("GET", TRANSCRIPT), `GET ${TRANSCRIPT} is served`).toBeTypeOf("function");
    const { sofer, record, run } = await setup();
    await record("he");
    await run();
    const info = sofer.requests.find((r) => r.method === "POST")!.body?.info as Record<string, unknown>;
    expect(info.primary_language).toBe("he");
    expect(info.hebrew_word_format, "only for English").toBeUndefined();
  });

  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-004
  it("is unavailable without a key, and the shiur still plays", async () => {
    expect(served("GET", TRANSCRIPT), `GET ${TRANSCRIPT} is served`).toBeTypeOf("function");
    const { h, sofer, record, status, run } = await setup({ key: false });
    const id = await record();
    await run();
    expect(await status(id)).toBe("unavailable");
    expect(sofer.requests).toEqual([]);
    expect((await h.call("GET", `/api/v1/assets/${id}/media`)).status).toBe(200);
  });

  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-005
  it("marks a transcript Sofer.ai failed as failed, without touching the shiur", async () => {
    expect(served("GET", TRANSCRIPT), `GET ${TRANSCRIPT} is served`).toBeTypeOf("function");
    const { h, record, due, status, manifest, run } = await setup({ finalStatus: "FAILED" });
    const id = await record();
    await run();
    await due(id);
    await run();
    await due(id);
    await run();
    expect(await status(id)).toBe("failed");
    expect((await manifest(id)).transcript.status).toBe("failed");
    expect((await h.call("GET", `/api/v1/assets/${id}/media`)).status).toBe(200);
    expect(code(await h.call("GET", `/api/v1/assets/${id}/transcript`))).toBe("404 recording.no_transcript");
  });

  // @feature SHIUR-007 A shiur's transcript from Sofer.ai, in the leader's language, line by line in the player
  // @ac 054/AC-002
  it("serves a processed shiur's audio to anyone, by byte range too", async () => {
    expect(served("GET", "/api/v1/assets/$assetId/audio"), "the audio route is served").toBeTypeOf("function");
    const { h, record } = await setup({ key: false });
    const id = await record();
    const whole = await h.call("GET", `/api/v1/assets/${id}/audio`);
    expect([whole.status, whole.headers.get("content-type")]).toEqual([200, "audio/mp4"]);
    const part = await h.call("GET", `/api/v1/assets/${id}/audio`, { headers: { range: "bytes=0-9" } });
    expect([part.status, part.bytes?.byteLength]).toEqual([206, 10]);
  });
});
