# Plan: spec 054

## Approach

- Migration 0009: `transcript_status` (queued, submitted, ready, failed, unavailable), `transcript_language` (default `en`),
  `transcript_attempts`, `transcript_after`, `transcript_job_id`, `transcript_submitted_at`, and a partial index for the queue.
- `server/jobs/transcript.ts`: claim one row (`FOR UPDATE SKIP LOCKED`), submit `audio.m4a` (inline base64 under 40 MB, or the
  public audio URL when `SOCIAL_PUBLIC_ORIGIN` is set), poll with a growing wait, then store `transcript.json` (words in ms) and
  `transcript.vtt` and mark the manifest. Without a key, `unavailable`. Processing (spec 052) queues the transcript when it
  finishes; the worker runs transcripts after processing.
- Public reads: `/api/v1/assets/{id}/transcript` and `/audio` (byte ranges as `/media`).
- Client: the language select beside Record (`recording-api.ts` remembers it in `localStorage`), `start` sends
  `transcriptLanguage`; the replay loads the transcript when the state says ready, and `ReplayBar` shows the line at the playing
  time with the spoken word marked, and a Transcript toggle.

## Tests

`api.transcripts.int.test.ts` runs the job against a fake Sofer.ai server (real Postgres, real ffmpeg for the processed audio).
`transcript-language.test.tsx` and the 054 block of `shiur-player.test.tsx` render the Record control and the bar. Each fails on
the base at its first assertion.
