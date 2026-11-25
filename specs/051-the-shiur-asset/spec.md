---
id: "051"
title: The shiur asset, only the leader recorded, the talking head kept, open by link, media in an object store
status: proposed
features: [SHIUR-002, SHIUR-003, SHIUR-004]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [recording, api]
risk: high
contract_impact: api-minor
---

## Problem

The owner decided (docs/plans/shiur.md D1, D2, D11, D12, D14; decision record 0011) that a recording is the leader's shiur: only
the leader's voice and camera are recorded, the place of their talking head is kept so a replay can show it there, anyone who
has the link can open it, signed out included, and its media lives in object storage, not in Postgres. Today the recording mixes
every participant's audio and tiles every camera, only the room's members can read it, and its media chunks are bytea rows.

## Acceptance criteria

- AC-001 WHILE the leader records a session with other people in its call THE SYSTEM SHALL record the recording person's own
  microphone only: no other participant's audio is mixed in, whatever joins, leaves or speaks
- AC-002 WHILE the leader records THE SYSTEM SHALL draw only the recording person's own camera into the recording's video, and the
  room's title card while their camera is off; other participants' cameras are never drawn
- AC-003 WHILE the leader records THE SYSTEM SHALL keep, in the recording's reader timeline, a `social.overlay` slice saying
  whether their camera is on and where their talking head is (the call window's box as fractions of the viewport), updated when
  either changes
- AC-004 WHEN anyone, signed in or not, asks for a ready recording by its id at `GET /api/v1/assets/{assetId}`,
  `/api/v1/assets/{assetId}/state` or `/api/v1/assets/{assetId}/media` THE SYSTEM SHALL answer with its metadata (title, the
  leader's name, duration, no member-only fields), its reader timeline and its media; a recording that is still recording,
  failed, or unknown SHALL be 404 there; listing a room's recordings stays members only
- AC-005 WHEN the recorder uploads a media chunk THE SYSTEM SHALL keep it in the object store under
  `recordings/<id>/raw/<seq>` and nothing of it in Postgres but its count and the last chunk's hash, accept a retried last chunk
  as before, and remove every object of a recording when the recording is deleted
- AC-006 THE SYSTEM SHALL delete the recordings made before this change and drop the media chunk table in its migration (D12)

## Out of scope

- A cloud bucket adapter: the object store is an interface with a filesystem store (`ASSET_STORE_DIR`) for local runs, e2e
  and the dev server; the bucket's adapter is added when the owner creates it (docs/plans/shiur.md section 7).
- Processing (remux, audio, chapters, manifest; spec 052) and the player (spec 053).

## Notes for the planner

- Audio: `CallMedia.localAudioTrack()` (the viewer's own microphone) feeds the mixer instead of `audioTracks()`.
- Video: the compositor's participants are the local participant only.
- Overlay: the recording controller's reader view adds the `social.overlay` slice from the call window's geometry and the local
  camera; it is moment-scoped data in the state track, never applied to a reader.
- Public reads use `access: "public"` endpoints on the public list, with a reason. The member endpoints stay as they are.
- Replaces 041's mixing of every participant (041/AC-008's "mixes the call's audio as it changes") and its members-only reads for
  ready recordings.
