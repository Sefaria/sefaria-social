# Plan: 063 shiurim with pinned assets, assets on profiles and in posts

Source: `LINKED_PANELS_AND_ASSETS_PLAN.md` 6.1, 6.3, D5, D8, D9, P2. Decision: `docs/decisions/0015-claude-assets.md`
(points 2, 3).

## T-001 The shiur parent and pinned assets (AC-001 to AC-004)

- Migration `0016_shiur_assets.sql`: `session_recordings.shiur_id` (null, `on delete set null`, indexed), `shiur_assets`,
  `posts_embed_check` re-created to allow `asset` (drop and add the constraint; no column changes).
- `server/services/shiurim.ts`: `createShiur`, `listMine`, `getShiur` (public: unlisted/public; ready recordings; pinned,
  not hidden assets with `contentUrl` and the signed `shiurUrl` of spec 061), `pinAsset`, `unpinAsset`.
- `claude-assets.ts`' `pinnedIn` reads `shiur_assets`.
- Routes `shiurim.ts` (GET mine, POST), `shiurim.$shiurId.ts` (GET public), `shiurim.$shiurId.assets.ts` (POST),
  `shiurim.$shiurId.assets.$assetId.ts` (DELETE). Error `shiur.not_found`.
- Tests: `app/src/api.shiurim.int.test.ts`; the schema walk seeds `shiur_assets`.

## T-002 Profile listing and the asset embed in posts (AC-005, AC-006)

- `claude-assets.ts`: `publicAssetsOf(profileId)`; route `profiles.$profileId.claude-assets.ts` (public).
- `posts.ts`: `asset` in `embedTargets` (title, owner's display name) and `mayEmbed` (own, or published; not hidden);
  answered as `Post.assetEmbed` (optional), never as `embed`, whose kinds stay three. `live.ts` ignores asset embeds.
- Tests: `app/src/api.claude-asset-listing.int.test.ts`.

## T-003 The interface (AC-007)

- `features/api/social-api.ts`: `profileAssets`, `myAssets`, `saveAsset`, `publishAsset`, `unpublishAsset`, `shiur`.
- `features/profile/ClaudeAssets.tsx` (`AssetList`, `OwnAssets` with the file input and Publish/Unpublish),
  `claude-assets.module.css`; `ProfilePage.tsx` shows them; `features/shiur/ShiurPage.tsx` lists the shiur's assets;
  `features/post/EmbedCard.tsx` renders the asset card. Strings in `features/shell/strings.ts` (English and Hebrew).
- Tests: `features/profile/claude-assets.test.tsx` (the profile lists and the post's asset card),
  `features/shiur/shiur-page.test.tsx`. The shiur page keeps spec 002's placeholder until a shiur loads.
