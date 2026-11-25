---
id: "054"
title: A shiur's transcript from Sofer.ai, in the leader's language, shown line by line in the player
status: proposed
features: [SHIUR-007]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [recording, api]
risk: high
contract_impact: api-minor
---

## Problem

The owner wants every shiur to have a transcript, made by Sofer.ai in the language the leader spoke, and shown in the player as
the shiur plays (docs/plans/shiur.md D10, 4.6, 5.4). Today a processed shiur (spec 052) has media, audio and chapters, but nothing
sends its audio anywhere, the leader cannot say which language they will speak, and the player (spec 053) has no text.

## Acceptance criteria

- AC-001 WHEN a recording has been processed and a Sofer.ai key is set THE SYSTEM SHALL send its audio to Sofer.ai, poll until
  the transcript is done, and keep its words with their times beside the asset; the asset's state SHALL say the transcript is
  `ready` and the manifest SHALL name it
- AC-002 WHEN anyone with the link asks for a ready shiur's transcript (`GET /api/v1/assets/{id}/transcript`) or its audio
  (`GET /api/v1/assets/{id}/audio`) THE SYSTEM SHALL answer without a sign-in, the audio by byte range too; before the transcript
  is ready the transcript read SHALL answer 404 `recording.no_transcript`
- AC-003 WHEN the leader turns recording on THE SYSTEM SHALL offer the transcript's language beside Record (English, Hebrew,
  Yiddish, French; English by default, with Hebrew words in Hebrew letters), remember the choice in the browser, and ask
  Sofer.ai for that language
- AC-004 WHILE no Sofer.ai key is set THE SYSTEM SHALL mark a processed recording's transcript `unavailable`, send nothing, and
  play the shiur as before
- AC-005 WHEN Sofer.ai answers that a transcript failed or was cancelled, or a submission fails three times, or it is not done
  after 6 hours, THE SYSTEM SHALL mark the transcript `failed` and leave the asset, its media and its manifest's playback as they
  were
- AC-006 WHILE a shiur with a ready transcript plays THE SYSTEM SHALL show the line being said under the player bar with the
  word being said marked, and a Transcript button SHALL hide and show it

## Out of scope

- Choosing the language in room settings (the plan's "and in room settings"): the choice is per recording, beside Record.
- Search inside transcripts, editing a transcript, re-running it in another language, a downloadable text file.
- A bucket: the audio goes to Sofer.ai inline (base64) unless `SOCIAL_PUBLIC_ORIGIN` names where the public audio URL can be
  fetched from.

## Notes for the planner

- Sofer.ai: `POST /v1/transcriptions/` (JSON `audio_url` or `audio_file`, `info{primary_language, hebrew_word_format,
num_speakers, title}`) returns the id; `GET /v1/transcriptions/{id}/status`; `GET /v1/transcriptions/{id}` for `text` and
  `timestamps[{word,start,end}]`. Bearer key `SOFER_API_KEY`; base `SOFER_API_URL` (default `https://api.sofer.ai`). No webhook.
- The queue is the processing queue on the row (decision 0013) with its own columns; Sofer.ai allows 5 requests a minute, so
  one job at a time, polling at 30 s growing to 5 minutes.
- Migration 0009 adds the transcript columns; nothing is deleted.
