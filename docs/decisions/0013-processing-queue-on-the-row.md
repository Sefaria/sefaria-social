# 0013. Asset processing is queued on the recording's own row

- Status: proposed
- Date: 2026-11-26
- Deciders: proposed in spec 052; the owner confirms by approving it

## Context

A finished recording needs processing (remux, audio, chapters, manifest; spec 052) in the background, retried and safe to run
twice, surviving a restart. The plan's research (docs/plans/shiur.md 5.3) recommended pg-boss: a job queue library on Postgres
with retries, backoff and singleton keys. Spec 054 adds a transcript to the same recording.

## Decision

The queue is the row: `session_recordings.process_status` (queued, running, done, failed), `process_attempts` and
`process_after` (a running job's lease or a retry's wait). A worker claims the earliest due row with
`FOR UPDATE SKIP LOCKED`, so two workers never take one row and a worker that died loses its lease. One kind of job per row
needs no library, no extra schema and no new dependency; the transcript (spec 054) gets its own columns of the same shape.

## Consequences

- The plan's pg-boss proposal is not taken. If jobs of many kinds or schedules appear, revisit with a library then.
- The worker runs in the server process and starts from the health check; `ASSET_WORKER=off` turns it off in a process.
