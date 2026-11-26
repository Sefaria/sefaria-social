---
id: "063"
title: A shiur holds recordings and pinned Claude assets; assets on profiles and as post cards
status: proposed
features: [SHIUR-012, FEED-077, FEED-078]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api, shiur, profile, post]
risk: high
contract_impact: api-minor
---

## Problem

The owner decided that a Claude asset is part of the shiur, a Social asset modelled properly: a shiur parent with its
recordings and its Claude assets (D5), each shiur pinning the asset version it was given with, so a recording replays with the
version it was made with even after the author saves a newer one (D8, D9). An asset needs no shiur (P2, default taken). The
plan also asks for a profile's public assets and for a post that shows an asset as a card (6.1, 6.3). The `shiurim` table
exists but nothing writes it, and the shiur page is a placeholder.

## Acceptance criteria

- AC-001 WHEN a signed-in user posts `POST /api/v1/shiurim` with a title, an optional visibility (`private`, `unlisted` the
  default, or `public`) and an optional `recordingId` THE SYSTEM SHALL create a shiur they own and attach the recording to it;
  a recording that is not theirs SHALL be 404 and no shiur created; `GET /api/v1/shiurim` SHALL list the caller's own shiurim;
  existing shiurim and recordings are unchanged by the migration
- AC-002 WHEN anyone asks `GET /api/v1/shiurim/{shiurId}` for an unlisted or public shiur THE SYSTEM SHALL answer its title,
  visibility, its owner's name and profile id, its ready recordings and its pinned assets in order, each asset with its pinned
  version, title, refs, first ref, public `contentUrl` and signed `shiurUrl` (spec 061); a private or unknown shiur SHALL be
  404 there; hidden assets are left out
- AC-003 WHEN the shiur's owner posts `POST /api/v1/shiurim/{shiurId}/assets` with `{assetId, versionId?}` THE SYSTEM SHALL pin
  that version (default: the asset's current version if it is the owner's asset, its published version otherwise), or move the
  pin if the asset is already there; the asset must be the caller's own or published and not hidden, and only its published
  version may be pinned when it is not theirs; `DELETE /api/v1/shiurim/{shiurId}/assets/{assetId}` SHALL remove it; anyone
  else, an unknown asset or version, or a version that may not be pinned SHALL get 404
- AC-004 WHEN the author saves a newer version of a pinned asset THE SYSTEM SHALL keep answering the pinned version in the
  shiur until its owner moves the pin
- AC-005 WHEN anyone asks `GET /api/v1/profiles/{profileId}/claude-assets` THE SYSTEM SHALL answer the published, not hidden
  assets of that person, newest first, each with id, title, description, refs, published version id and its `contentUrl`
- AC-006 WHEN a post is written with `embed: {kind: "asset", id}` THE SYSTEM SHALL accept it when the asset is the author's own
  or published, and not hidden, and answer the post with `assetEmbed: {id, title, leader, contentUrl}` (the asset's title, its
  author's name and its file), a field of its own so `embed.kind` keeps its three values for older surfaces; any other asset
  SHALL be 404 and no post created; posts with other embeds are unchanged
- AC-007 WHEN a profile page is shown THE SYSTEM SHALL list that person's public assets, each with its title, description and
  an Open link to its content in a new tab; on the viewer's own page it SHALL also list their own assets with Publish or
  Unpublish (a refusal because the profile is not verified says so) and a file input that uploads an `.html` asset and shows
  the problems of a refused file; a shiur page SHALL list its pinned assets the same way; a post card with an asset embed SHALL
  show its title, "by" its author and an Open link, or "no longer available"

## Out of scope

- Editing or deleting a shiur, scheduling, a shiur's transcript and reader timeline as shiur-level fields (they stay on the
  recording), opening an asset as a reader panel (reader-next Phase 2 and 3), the composer recognizing an asset link.
- Dropping `shiur_recordings` (a contract step for a later release, decision 0015).

## Notes for the planner

- Migration (expand only): `shiurim.visibility` may also be `unlisted`; `teacher_user_id` is the owner (renaming it is a
  contract step); `session_recordings.shiur_id uuid null references shiurim on delete set null` (indexed); `shiur_assets`
  (shiur_id, asset_id, version_id, position, created_at; primary key (shiur_id, asset_id); deleted with the shiur, the asset or
  the version). `posts_embed_check` allows `asset`.
- `Post.assetEmbed` is optional and present only on a post that embeds an asset (older exact-match tests); `embed.kind`'s
  values are unchanged, so `npm run api:breaking` sees no widened enum and older surfaces show such a post without a card.
- The live cards (spec 056) ignore asset embeds.
- UI: `features/assets/` (AssetList, OwnAssets with upload, AssetEmbedCard parts), used by `features/profile/ProfilePage.tsx`,
  `features/shiur/ShiurPage.tsx` and `features/post/EmbedCard.tsx`; strings in English and Hebrew; Open links are real
  `<a href target="_blank" rel="noopener noreferrer">` to the content origin, never an iframe in the page (the reader page
  loads no third-party code; `docs/runbooks/security.md`). Mockup: `mockup.html`.
- The shiur page keeps spec 002's placeholder (its id and a link into the reader) while it loads and for an id that is not
  an unlisted or public shiur, so spec 002's tests of that page hold; it adds a line saying the shiur is private or unknown.
