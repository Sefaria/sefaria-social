# Plan: spec 052

## Approach

- `server/jobs/process-asset.ts`: `claimNext` (one row, `FOR UPDATE SKIP LOCKED`, a 15-minute lease), `processRecording`
  (concatenate raw chunks, `ffmpeg -c copy -cues_to_front 1` into `media.webm`, `ffmpeg -vn -c:a aac` into `audio.m4a`,
  `ffprobe` for duration and streams, `timeline.json`, chapters from `jobs/chapters.ts`, `manifest.json` last, then done and the
  raw prefix removed), `runPending`, and the worker (`ensureAssetWorker` from the health route, `kickAssetWorker` on finish).
  A failure goes back to the queue after 30 s, then 120 s (with up to 20% jitter); the third failure marks it failed.
- `finishRecording` and `finaliseStale` queue the row. The media reads serve `media.webm` by range once it exists (`size`,
  `getRange` on the object store; at most 8 MB an answer), else the raw chunks whole. The endpoint helper lets a binary answer
  carry `accept-ranges` and `content-range`. `GET /api/v1/assets/{id}/manifest` (public) answers once processed.
- Dockerfile: ffmpeg from Debian in the runtime stage. CI: ffmpeg in the integration and e2e jobs.

## Tests

`api.processing.int.test.ts` makes a real 6-second WebM with ffmpeg, uploads it in three chunks with a timeline, finishes, and
runs the queue itself (`ASSET_WORKER=off`). It fails on the base at its first assertion: the manifest route does not exist.

## Risks

- Processing runs in the web server's process; a long ffmpeg run takes CPU from requests. One job at a time, 10-minute limit.
- A recording with no audio stream gets no `audio.m4a`; the manifest says so (`files.audio: null`).
