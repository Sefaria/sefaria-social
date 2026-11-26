---
id: "062"
title: Verified profiles publish Claude assets to the segments they cover, read by ref for the sidebar, with staff takedown
status: proposed
features: [IDENT-106, SHIUR-011, API-053]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, profile]
risk: high
contract_impact: api-minor
---

## Problem

A published asset is discoverable from the sidebar of every segment it covers (plan 1, 6.3). The owner decided that this needs
the author's "blue check", a verified profile (D6), and the plan asks for a staff takedown that works at once, and for removing
a verification to hide every asset of that profile from the sidebar (6.6). The reader's sidebar asks once per section and
counts per segment, like the findings read API (`docs/plans/2026-11-25-skills-store.md` in ai-chatbot).

## Acceptance criteria

- AC-001 WHEN staff run `npm run verify-profile -- <profile id or @handle> --by <name>` THE SYSTEM SHALL mark that profile
  verified with the time and who did it; `--off` SHALL remove the mark; a profile that does not exist SHALL exit with an error
  and change nothing; a verified profile's API answers (`GET /api/v1/profiles/{id}`, `/profiles/me`) SHALL carry
  `verified: true`, and an unverified one's SHALL have no `verified` field, as before
- AC-002 WHEN the owner of an asset whose person profile is verified posts `POST /api/v1/claude-assets/{assetId}/publish` with
  an optional `versionId` (the current version by default) THE SYSTEM SHALL make that version the published one and index one
  row per covered segment (asset, version, segment ref, its section ref, the declared ref and its label), replacing the rows of
  any version published before; an owner who is not verified SHALL get 403 `asset.not_verified` and nothing changes; anyone
  else, or a version of another asset, SHALL get 404
- AC-003 WHEN the owner posts `POST /api/v1/claude-assets/{assetId}/unpublish` THE SYSTEM SHALL clear the published version and
  remove its rows; saving a new version SHALL leave the published version as it was
- AC-004 WHEN anyone asks `GET /api/v1/claude-assets/ref/{ref}` for a section or a segment in Sefaria's normal form THE SYSTEM
  SHALL answer `{ref, assets: [...]}` with every published, not hidden asset whose author's profile is verified and that
  covers a segment of that ref, each with `id`, `title`, `description`, `author {name, profileId, verified}`, `anchorRefs`
  (the covered segments inside the asked ref, in text order), `refs` (the declared refs in normal form), `versionId` and the
  public `contentUrl`; an unknown ref SHALL answer an empty list; the answer SHALL be cacheable for 60 seconds and carry CORS
  headers for the origins in `SOCIAL_ALLOWED_ORIGINS`
- AC-005 WHEN staff run `npm run asset-takedown -- <asset id>` (or `--restore`) THE SYSTEM SHALL mark the asset hidden (or
  not): a hidden asset leaves the ref answer, its reads and its content at once, and its owner sees it marked hidden
- AC-006 WHEN a profile's verification is removed THE SYSTEM SHALL leave its published assets out of the ref answer at once,
  without changing them, and bring them back if it is verified again

## Out of scope

- A staff web interface; the reader's sidebar row (reader-next, Phase 3); ranking among several assets on one segment
  (newest published first).
- Verifying institution profiles (they own no assets).

## Notes for the planner

- `profiles` gains `verified boolean not null default false`, `verified_at`, `verified_by` (expand only). `asset_refs`:
  asset_id, version_id, segment_ref, section_ref, source_ref, label, position (text order within the version); indexes on
  segment_ref and section_ref; deleted with the asset or the version. `Profile.verified` is `z.literal(true).optional()`: an
  always-present field breaks the exact-match tests of older specs.
- The verification is a staff CLI like `purge-user` (having the server's `DATABASE_URL` is what makes it staff-only); the
  token's `staff` claim is not used, so no API route can grant a check mark.
- Section of a segment: the expand answer's section ref that the segment starts with (`<section>:`), else the segment with its
  last `:part` removed.
- `GET /api/v1/claude-assets/ref/{ref}` is public, on the public list with its reason; `cache-control: public, max-age=60`.
  Ordered by published time, newest first; at most 50 assets.
- The publish route answers the asset (`ClaudeAsset`) with `publishedVersionId` set.
