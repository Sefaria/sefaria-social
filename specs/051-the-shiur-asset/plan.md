# Plan: spec 051

## Approach

1. **Capture (T-001).** `CallMedia.localAudioTrack()` gives the recorder the viewer's own microphone only; the compositor's
   participants are filtered to the local one. `features/av/head-place.ts` holds the call window's box as viewport fractions
   (the window reports it); the recording controller wraps the reader view it records from with `withOverlay`, which adds the
   `social.overlay` slice ({camera, head}) to every snapshot and emits a change when the camera or the head place changes.
2. **Storage and reads (T-002).** `server/services/object-store.ts`: an interface (put, get, list, removePrefix) and a filesystem
   store under `ASSET_STORE_DIR`. Media chunks go to `recordings/<id>/raw/<seq>`; `session_recordings` gains `media_chunks` and
   `last_chunk_sha256` (the retry check), and migration 0007 deletes earlier recordings (D12) and drops the chunk table, with a
   contract note. Deleting a recording removes its prefix; deleting a room or a user sweeps objects whose rows went
   (`sweepOrphanObjects`). Three public endpoints (`/api/v1/assets/{id}`, `/state`, `/media`) serve a ready recording without
   its room id or any user id.

## Tests

| AC      | Test                                                                                   | Fails on base because                                  |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 001–003 | `recorder.test.ts`, "only the leader is recorded"                                      | every participant is mixed and drawn; no overlay slice |
| 004     | `api.assets.int.test.ts`                                                               | the routes do not exist                                |
| 005     | `api.assets.int.test.ts`; `api.recordings.int.test.ts` now reads chunks from the store | chunks are bytea rows                                  |
| 006     | `api.assets.int.test.ts`                                                               | the table exists                                       |

## Risks

- The filesystem store is not shared between server replicas; the dev server runs one. A bucket adapter is needed before more
  than one replica serves recordings (owner's to-do: the bucket).
- `sweepOrphanObjects` lists every recording prefix; fine for a filesystem store of test data, to be replaced by a list per
  deleted id when a bucket holds many.
