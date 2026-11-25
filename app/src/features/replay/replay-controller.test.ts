// The replay controller (spec 042) against the fake host, a fake fetch answering the recording endpoints, a fake media element
// and fake object URLs. Modules load through import.meta.glob so that, on a base without them, the first assertion fails.
import { describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as ControllerModule from "./replay-controller";
import type * as ApiModule from "./replay-api";
import type * as FixtureModule from "./test-track";

const mods = {
  controller: import.meta.glob<typeof ControllerModule>("./replay-controller.ts"),
  api: import.meta.glob<typeof ApiModule>("./replay-api.ts"),
  fixture: import.meta.glob<typeof FixtureModule>("./test-track.ts"),
};

const REC = "9b1c2d3e-4b5a-4c6d-8e7f-001122334455";
const API = "http://localhost:3200";
const MEDIA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

type Answers = { meta?: number; state?: unknown; stateStatus?: number; media?: number };

async function setup(answers: Answers = {}, url = `/Genesis.1?ctx=social.rec.${REC}`) {
  const controllerMod = await mods.controller["./replay-controller.ts"]?.();
  expect(controllerMod, "app/src/features/replay/replay-controller.ts exists").toBeDefined();
  const { createReplayApi } = (await mods.api["./replay-api.ts"]!())!;
  const { createFakeMedia, trackJson, flush } = (await mods.fixture["./test-track.ts"]!())!;
  const fake = createFakeHost({ url, viewer: { id: 4242, name: "Test Learner" }, config: { apiOrigin: API } });
  const requests: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    requests.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u === `${API}/api/v1/recordings/${REC}`) {
      return answers.meta && answers.meta !== 200
        ? json({ error: "not_found" }, answers.meta)
        : json({ id: REC, title: "Shiur", durationMs: 20_000, mediaBytes: MEDIA.byteLength, mime: "video/webm" });
    }
    if (u === `${API}/api/v1/recordings/${REC}/state`) return json(answers.state ?? trackJson(), answers.stateStatus ?? 200);
    if (u === `${API}/api/v1/recordings/${REC}/media`) {
      if (answers.media && answers.media !== 200) return new Response("", { status: answers.media });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(MEDIA.slice(0, 4));
          c.enqueue(MEDIA.slice(4));
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "video/webm", "content-length": String(MEDIA.byteLength) },
      });
    }
    return json({}, 404);
  });
  const media = createFakeMedia();
  const play = vi.spyOn(media, "play");
  const urls = { created: [] as Blob[], revoked: [] as string[] };
  const fixDuration = vi.fn(async (blob: Blob, _ms: number) => blob);
  const replay = controllerMod!.createReplayController({
    host: fake.host,
    api: createReplayApi(fake.host, fetchImpl as unknown as typeof fetch),
    createMedia: () => media as unknown as ControllerModule.ReplayMediaElement,
    fixDuration,
    objectUrls: {
      create: (b) => {
        urls.created.push(b);
        return "blob:replay-1";
      },
      revoke: (u) => void urls.revoked.push(u),
    },
  });
  const views: ControllerModule.ReplayView[] = [];
  replay.subscribe(() => views.push(replay.view()));
  return { replay, fake, media, play, urls, fixDuration, requests, views, flush };
}

describe("replay controller", () => {
  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-006
  it("an address with ctx=social.rec.<id> opens the player paused at the start, without playing", async () => {
    const { replay, fake, media, play, urls, fixDuration, requests, views, flush } = await setup();
    replay.fromContext();
    await vi.waitFor(() => expect(replay.view().kind).toBe("ready"));
    await flush();

    expect(views[0]).toEqual({ kind: "loading", recordingId: REC, progress: null });
    const progress = views.flatMap((v) => (v.kind === "loading" && v.progress !== null ? [v.progress] : []));
    expect(progress).toEqual([0, 0.4, 1]);
    expect(requests.map((r) => r.url)).toEqual([
      `${API}/api/v1/recordings/${REC}`,
      `${API}/api/v1/recordings/${REC}/state`,
      `${API}/api/v1/assets/${REC}/manifest`, // spec 053: its chapters, once processed (here: none, 404)
      `${API}/api/v1/assets/${REC}/transcript`, // spec 054: its transcript, once made (here: none, 404)
      `${API}/api/v1/recordings/${REC}/media`,
    ]);
    expect(requests.every((r) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(r.auth ?? ""))).toBe(true);
    expect(fixDuration).toHaveBeenCalledWith(expect.any(Blob), 20_000);
    expect(urls.created[0]!.size).toBe(MEDIA.byteLength);
    expect(media).toMatchObject({ src: "blob:replay-1", playsInline: true, muted: false, paused: true, currentTime: 0 });
    expect(replay.mediaElement()).toBe(media);
    expect(play).not.toHaveBeenCalled();
    expect(replay.view()).toMatchObject({ kind: "ready", recordingId: REC, player: { playing: false, t: 0, following: true } });
    expect(fake.calls.applied).toEqual([
      { snapshot: expect.objectContaining({ url: "/Genesis.1" }), ctx: { origin: "playback", persist: false } },
    ]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-006
  it("opening with autoplay plays", async () => {
    const { replay, play } = await setup();
    await replay.open(REC, { autoplay: true });
    expect(play).toHaveBeenCalledTimes(1);
    expect(replay.view()).toMatchObject({ kind: "ready", player: { playing: true } });
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-006
  it("closing stops the media, frees the URL, drops the context and leaves the reader where it is", async () => {
    const { replay, fake, media, urls } = await setup();
    await replay.open(REC, { autoplay: true });
    media.advance(5);
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.2?ctx=social.rec.${REC}`));
    const applied = fake.calls.applied.length;

    replay.close();
    expect(media.paused).toBe(true);
    expect(media.src).toBe("");
    expect(urls.revoked).toEqual(["blob:replay-1"]);
    expect(replay.view()).toEqual({ kind: "closed" });
    expect(replay.mediaElement()).toBe(null);
    expect(fake.calls.navigate).toEqual([{ to: "/Genesis.2", replace: true, state: undefined }]);
    expect(fake.url()).toBe("/Genesis.2");
    expect(fake.host.reader.context.get()).toBe(null);

    media.advance(5);
    expect(fake.calls.applied.length, "nothing more is applied").toBe(applied);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-008
  it.each([404, 403])("a recording answered %i says not found and leaves the reader untouched", async (status) => {
    const { replay, fake, requests } = await setup({ meta: status });
    await replay.open(REC);
    expect(replay.view()).toEqual({ kind: "error", recordingId: REC, reason: "not-found" });
    expect(fake.calls.applied).toEqual([]);
    expect(fake.calls.navigate).toEqual([]);
    expect(fake.url()).toBe(`/Genesis.1?ctx=social.rec.${REC}`);
    // Spec 053: refused as a member, it asks the public read (a ready recording opens for anyone with its link); also refused.
    expect(requests.map((r) => r.url)).toEqual([`${API}/api/v1/recordings/${REC}`, `${API}/api/v1/assets/${REC}`]);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-008
  it("a state track that fails the schema is invalid: the media is not fetched and the reader is untouched", async () => {
    expect(mods.fixture["./test-track.ts"], "app/src/features/replay/test-track.ts exists").toBeDefined();
    const { trackJson } = (await mods.fixture["./test-track.ts"]!())!;
    const bad = trackJson();
    (bad.messages as { seq: number }[])[2]!.seq = 9;
    const { replay, fake, requests } = await setup({ state: bad });
    await replay.open(REC);
    expect(replay.view()).toEqual({ kind: "error", recordingId: REC, reason: "invalid" });
    expect(requests.map((r) => r.url)).not.toContain(`${API}/api/v1/recordings/${REC}/media`);
    expect(fake.calls.applied).toEqual([]);
    expect(fake.url()).toBe(`/Genesis.1?ctx=social.rec.${REC}`);
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  // @ac 042/AC-008
  it("a media download that fails is a failure, and the reader is untouched", async () => {
    const { replay, fake, urls } = await setup({ media: 500 });
    await replay.open(REC);
    expect(replay.view()).toEqual({ kind: "error", recordingId: REC, reason: "failed" });
    expect(fake.calls.applied).toEqual([]);
    expect(urls.created).toEqual([]);
    expect(fake.calls.report).toContainEqual({ kind: "error", name: "replay-load-failed", data: { reason: "failed" } });
  });

  // @feature SESS-065 Replay a recording in the reader with the video in the floating window
  it("an address without a recording context opens nothing", async () => {
    const { replay, requests } = await setup({}, "/Genesis.1?ctx=social.room.6f1c2d3e-4b5a-4c6d-8e7f-001122334455");
    replay.fromContext();
    expect(replay.view()).toEqual({ kind: "closed" });
    expect(requests).toEqual([]);
  });
});
