// Acceptance tests for spec 052, server side: a finished recording is queued and processed — its raw chunks remuxed by ffmpeg
// into a seekable media file with its audio, timeline and manifest (chapters, video or not), served by byte range — once, even
// when run twice, retried with a backoff and given up after three failures (L2, real Postgres, real ffmpeg, a fresh object
// store). The media is a real six-second WebM made by ffmpeg, uploaded in chunks as a recorder would. Each test first asserts
// its route is served, so on a base without the feature it fails on that assertion.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const MANIFEST = "/api/v1/assets/$assetId/manifest";

function served(method: string, p: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(p);
  const r = route as { fullPath?: string; options?: { server?: { handlers?: Record<string, unknown> } } } | undefined;
  if (r?.fullPath?.replace(/\/$/, "") !== p) return undefined;
  return r.options?.server?.handlers?.[method];
}

const ASSET_DIR = mkdtempSync(path.join(tmpdir(), "social-assets-"));
process.env.ASSET_STORE_DIR = ASSET_DIR;
process.env.ASSET_WORKER = "off"; // the tests run the queue themselves

/** A real WebM: six seconds of a test picture and a tone, as a recorder's chunks would make up. */
const WEBM = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), "social-webm-"));
  const out = path.join(dir, "t.webm");
  execFileSync("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...["-f", "lavfi", "-i", "testsrc=duration=6:size=160x120:rate=10"],
    ...["-f", "lavfi", "-i", "sine=duration=6"],
    ...["-c:v", "libvpx", "-b:v", "100k", "-c:a", "libopus", "-shortest", out],
  ]);
  return new Uint8Array(readFileSync(out));
})();

const OWNER = 952001;
const MIME = "video/webm;codecs=vp8,opus";
type ErrorJson = { error: { code: string } };
const code = (r: { status: number; json: unknown }) => `${r.status} ${(r.json as ErrorJson | null)?.error?.code ?? ""}`.trim();

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const summary = (ref: string, heRef: string) => ({ "social.summary": { v: 1, value: { ref, heRef, title: ref } } });
const overlay = (camera: boolean) => ({ "social.overlay": { v: 1, value: { camera, head: null } } });

async function setup() {
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = () => resetConfig();
  const jobs = await import("~/server/jobs/process-asset");
  const owner = await h.token(OWNER, { name: "Rav Leader" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: owner, body: { title: "Processed shiur" } })).json as {
    id: string;
  };
  /** Record `media` in chunks with a timeline that stays on Genesis 1, skims Genesis 2 and stays on Exodus 3, then finish. */
  const record = async (media: Uint8Array, camera = true) => {
    const rec = (await h.call("POST", `/api/v1/rooms/${room.id}/recordings`, { token: owner, body: { mime: MIME } })).json as {
      id: string;
    };
    const size = Math.ceil(media.byteLength / 3);
    for (let seq = 0; seq * size < media.byteLength; seq++)
      expect(
        (
          await h.call("PUT", `/api/v1/recordings/${rec.id}/media/${seq}`, {
            token: owner,
            bytes: media.subarray(seq * size, (seq + 1) * size),
          })
        ).status,
      ).toBe(204);
    const messages = [
      {
        type: "keyframe",
        seq: 0,
        t: 0,
        snapshot: { v: 1, url: "/Genesis.1", slices: { ...summary("Genesis 1", "בראשית א׳"), ...overlay(camera) } },
      },
      { type: "change", seq: 1, t: 3500, change: { url: "/Genesis.2", slices: summary("Genesis 2", "בראשית ב׳") } },
      { type: "change", seq: 2, t: 4000, change: { url: "/Exodus.3", slices: summary("Exodus 3", "שמות ג׳") } },
    ];
    expect((await h.call("POST", `/api/v1/recordings/${rec.id}/state`, { token: owner, body: { messages } })).status).toBe(200);
    expect(
      (await h.call("POST", `/api/v1/recordings/${rec.id}/finish`, { token: owner, body: { durationMs: 6000 } })).status,
    ).toBe(200);
    return rec.id;
  };
  const files = async (id: string) => {
    try {
      return (await readdir(path.join(ASSET_DIR, "recordings", id))).sort();
    } catch {
      return [];
    }
  };
  const status = async (id: string) =>
    (
      await h.sql<{ process_status: string | null; process_attempts: number }>(
        "select process_status, process_attempts from session_recordings where id = $1",
        [id],
      )
    )[0];
  return { h, owner, record, files, status, jobs };
}

describe("spec 052: processing stays safe (review findings)", () => {
  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  it("streams an unprocessed recording's chunks, and answers 404 when its media is missing", async () => {
    const { h, record, jobs } = await setup();
    void jobs;
    const id = await record(WEBM);
    const raw = await h.call("GET", `/api/v1/assets/${id}/media`);
    expect([raw.status, raw.bytes?.byteLength]).toEqual([200, WEBM.byteLength]);
    expect(raw.headers.get("content-length")).toBe(String(WEBM.byteLength));
    const { rm } = await import("node:fs/promises");
    await rm(path.join(ASSET_DIR, "recordings", id, "raw"), { recursive: true, force: true });
    expect(code(await h.call("GET", `/api/v1/assets/${id}/media`))).toBe("404 recording.not_found");
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  it("fails a row whose tries are spent even when the worker died without catching an error", async () => {
    const { h, record, status, jobs } = await setup();
    const id = await record(WEBM);
    // Three claims that ended in a crash (no error caught): running, lease run out, attempts spent.
    await h.sql(
      "update session_recordings set process_status = 'running', process_attempts = 3, process_after = now() - interval '1 second' where id = $1",
      [id],
    );
    expect(await jobs.runPending()).toBe(0);
    expect(await status(id)).toEqual({ process_status: "failed", process_attempts: 3 });
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  it("writes nothing for a claim another worker took over, and fails at once a recording with no media", async () => {
    const { h, record, files, status, jobs } = await setup();
    const id = await record(WEBM);
    const claim = await jobs.claimNext();
    expect(claim?.id).toBe(id);
    // The lease ran out and another worker claimed it (attempt 2) while this one still worked.
    await h.sql("update session_recordings set process_attempts = process_attempts + 1 where id = $1", [id]);
    await jobs.processRecording(id, claim!.attempt);
    expect(await files(id), "the late job wrote nothing").toEqual(["raw"]);
    expect((await status(id))?.process_status).toBe("running");

    const empty = await record(WEBM);
    await h.sql("update session_recordings set media_chunks = 0 where id = $1", [empty]);
    await jobs.runPending();
    expect(await status(empty)).toEqual({ process_status: "failed", process_attempts: 1 });
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  it("makes no chapter of a malformed address or a page that is not a text", async () => {
    const { chaptersOf } = await import("~/server/jobs/chapters");
    const at = (seq: number, t: number, url: string) =>
      seq === 0
        ? ({ type: "keyframe", seq, t, snapshot: { v: 1, url, nav: null, slices: {} } } as const)
        : ({ type: "change", seq, t, change: { url } } as const);
    const messages = [at(0, 0, "/%E0%A4%A"), at(1, 4000, "/topics/shabbat"), at(2, 9000, "/Genesis.3")];
    expect(chaptersOf(messages as never).chapters).toEqual([{ t: 9000, ref: "Genesis 3", heRef: null }]);
  });
});

describe("spec 052: processing a recording into its asset", () => {
  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  // @ac 052/AC-001
  // @ac 052/AC-002
  it("queues a finished recording and processes it into media, audio, timeline and manifest, removing the raw chunks", async () => {
    expect(served("GET", MANIFEST), `GET ${MANIFEST} is served`).toBeTypeOf("function");
    const { h, record, files, status, jobs } = await setup();
    const id = await record(WEBM);
    expect(await status(id)).toEqual({ process_status: "queued", process_attempts: 0 });
    expect(code(await h.call("GET", `/api/v1/assets/${id}/manifest`))).toBe("404 recording.not_processed");

    expect(await jobs.runPending()).toBe(1);
    expect(await status(id)).toEqual({ process_status: "done", process_attempts: 1 });
    expect(await files(id)).toEqual(["audio.m4a", "manifest.json", "media.webm", "timeline.json"]);

    const manifest = (await h.call("GET", `/api/v1/assets/${id}/manifest`)).json as {
      durationMs: number;
      hasVideo: boolean;
      files: { media: { bytes: number; sha256: string }; audio: { type: string } | null };
    };
    expect(Math.abs(manifest.durationMs - 6000)).toBeLessThan(250);
    expect(manifest.hasVideo).toBe(true);
    expect(manifest.files.audio?.type).toBe("audio/mp4");
    const file = path.join(ASSET_DIR, "recordings", id, "media.webm");
    expect(manifest.files.media.bytes).toBe((await readFile(file)).byteLength);
    // The remuxed file knows its length (a MediaRecorder file does not).
    const probed = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    expect(Math.abs(Number(String(probed)) - 6)).toBeLessThan(0.25);
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  // @ac 052/AC-003
  it("makes a chapter of each place the leader stayed, dropping one passed through within 3 seconds", async () => {
    expect(served("GET", MANIFEST), `GET ${MANIFEST} is served`).toBeTypeOf("function");
    const { h, record, jobs } = await setup();
    const id = await record(WEBM, false);
    await jobs.runPending();
    const manifest = (await h.call("GET", `/api/v1/assets/${id}/manifest`)).json as { chapters: unknown; hasVideo: boolean };
    expect(manifest.chapters).toEqual([
      { t: 0, ref: "Genesis 1", heRef: "בראשית א׳" },
      { t: 4000, ref: "Exodus 3", heRef: "שמות ג׳" },
    ]);
    expect(manifest.hasVideo, "the camera was never on: an audio-only asset").toBe(false);
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  // @ac 052/AC-004
  it("serves the processed media by byte range, and the whole file without one", async () => {
    expect(served("GET", MANIFEST), `GET ${MANIFEST} is served`).toBeTypeOf("function");
    const { h, record, jobs } = await setup();
    const id = await record(WEBM);
    await jobs.runPending();
    const size = (await readFile(path.join(ASSET_DIR, "recordings", id, "media.webm"))).byteLength;
    const part = await h.call("GET", `/api/v1/assets/${id}/media`, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers?.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(part.headers?.get("accept-ranges")).toBe("bytes");
    expect(part.bytes?.byteLength).toBe(100);
    const tail = await h.call("GET", `/api/v1/assets/${id}/media`, { headers: { range: "bytes=-10" } });
    expect(tail.headers?.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    expect(code(await h.call("GET", `/api/v1/assets/${id}/media`, { headers: { range: `bytes=${size}-` } }))).toBe(
      "416 request.range_not_satisfiable",
    );
    const whole = await h.call("GET", `/api/v1/assets/${id}/media`);
    expect([whole.status, whole.bytes?.byteLength]).toEqual([200, size]);
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  // @ac 052/AC-005
  it("processes once when run twice, and gives up after three failed tries with the raw chunks kept", async () => {
    expect(served("GET", MANIFEST), `GET ${MANIFEST} is served`).toBeTypeOf("function");
    const { h, record, files, status, jobs } = await setup();
    const id = await record(WEBM);
    await jobs.runPending();
    const first = await readFile(path.join(ASSET_DIR, "recordings", id, "manifest.json"), "utf8");
    // Run it again (a lost lease): nothing changes.
    await h.sql("update session_recordings set process_status = 'queued', process_after = now() where id = $1", [id]);
    await jobs.runPending();
    expect(await readFile(path.join(ASSET_DIR, "recordings", id, "manifest.json"), "utf8")).toBe(first);
    expect((await status(id))?.process_status).toBe("done");

    // Bytes that are not a media file: three tries, waiting between them, then failed, with the raw chunks kept.
    const broken = await record(new TextEncoder().encode("not a webm file, ".repeat(40)));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await h.sql("update session_recordings set process_after = now() where id = $1", [broken]);
      await jobs.runPending();
      const s = await status(broken);
      expect(s?.process_attempts).toBe(attempt);
      expect(s?.process_status).toBe(attempt < 3 ? "queued" : "failed");
      if (attempt < 3) {
        const [row] = await h.sql<{ waits: boolean }>(
          "select process_after > now() + interval '20 seconds' as waits from session_recordings where id = $1",
          [broken],
        );
        expect(row?.waits, "a retry waits").toBe(true);
      }
    }
    expect(await files(broken)).toEqual(["raw"]);
    // It still plays, from the raw chunks.
    expect((await h.call("GET", `/api/v1/assets/${broken}/media`)).status).toBe(200);
  });

  // @feature SHIUR-005 Processing a recording into a seekable asset with a manifest and chapters
  // @ac 052/AC-006
  it("installs ffmpeg in the server image, and starts the worker from the health check", async () => {
    expect(served("GET", MANIFEST), `GET ${MANIFEST} is served`).toBeTypeOf("function");
    const { fileURLToPath } = await import("node:url");
    const dockerfile = await readFile(fileURLToPath(new URL("../../Dockerfile", import.meta.url)), "utf8");
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM "));
    expect(runtime).toMatch(/apt-get install[^\n]*ffmpeg/);
    const health = await readFile(fileURLToPath(new URL("./routes/api/v1/health.ts", import.meta.url)), "utf8");
    expect(health).toContain("ensureAssetWorker()");
    await writeFile(path.join(ASSET_DIR, ".touched"), ""); // the store directory is ours
  });
});
