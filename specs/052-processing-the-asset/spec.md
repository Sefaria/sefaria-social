---
id: "052"
title: Processing a recording into its asset, a seekable file, its audio, a manifest and chapters
status: proposed
features: [SHIUR-005]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [recording, api]
risk: high
contract_impact: api-minor
---

## Problem

A browser's MediaRecorder writes WebM with no duration and no seek index, so a player cannot jump to a chapter, and the
recording is a pile of 5-second chunks. The plan (docs/plans/shiur.md 4.5, 5.1, 5.3; D11 approved ffmpeg in the server image)
turns a finished recording into its asset: one seekable media file, its audio for a transcript, the reader timeline, a
manifest and chapters, made in the background, retried, and safe to run twice.

## Acceptance criteria

- AC-001 WHEN a recording is finished (or finalised after its uploads stopped) THE SYSTEM SHALL queue it for processing once;
  it SHALL stay playable from its raw chunks until processing is done
- AC-002 WHEN a queued recording is processed THE SYSTEM SHALL write, in the object store beside it, `media.webm` (the raw
  chunks remuxed without re-encoding, with a duration and a seek index), `audio.m4a` (its audio), `timeline.json` (the reader
  timeline) and last `manifest.json` (each file's size and SHA-256, the duration, whether the leader's camera was ever on, the
  chapters), mark it done, and remove its raw chunks
- AC-003 THE SYSTEM SHALL make a chapter {t, ref, heRef} of each place the leader's text stayed, from the timeline's summary
  slice, and drop a place the leader left within 3 seconds
- AC-004 WHEN anyone who may read a processed recording asks for its media with a byte range THE SYSTEM SHALL answer 206 with
  that range (at most 8 MB per answer) and `Content-Range`, 416 for a range outside the file, and the whole file without a range
- AC-005 WHEN processing runs twice for one recording THE SYSTEM SHALL leave the same files; WHEN it fails THE SYSTEM SHALL try
  again after a wait, and after 3 failed tries mark it failed, keeping its raw chunks so it still plays
- AC-006 THE SYSTEM SHALL have ffmpeg in the server image, and start the processing worker with the server (from its health
  check), so work left by a restart is picked up

## Out of scope

- The transcript (spec 054) and the player (spec 053). A cloud bucket adapter (section 7 of the plan).

## Notes for the planner

- The queue is the recording's row (decision 0013): `process_status`, `process_attempts`, `process_after`, claimed with
  `FOR UPDATE SKIP LOCKED`. The plan's research proposed pg-boss; one job kind per row does not need a library or its schema.
- `ASSET_WORKER=off` keeps the worker from starting in a process (tests run the queue themselves).
- A processed file is read by range from the object store (`size`, `getRange`), never whole into memory for a range.
