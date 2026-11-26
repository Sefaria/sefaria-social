# Plan: 062 verified profiles, publish, the ref read API, takedown

Source: `LINKED_PANELS_AND_ASSETS_PLAN.md` 6.1, 6.3, 6.6, D6; the findings read API in ai-chatbot
`docs/plans/2026-11-25-skills-store.md`. Decision: `docs/decisions/0015-claude-assets.md` (point 9).

## T-001 Verified profiles and the staff commands (AC-001, AC-005)

- Migration `0015_asset_publish.sql`: `profiles.verified` (not null default false), `verified_at`, `verified_by`; `asset_refs`.
- `server/services/staff.ts`: `setVerified(db, profileRef, on, by)` (id or @handle), `setHidden(db, assetId, on)`.
- `app/scripts/verify-profile.ts`, `app/scripts/asset-takedown.ts`, root `package.json` scripts.
- `Profile.verified` optional (only `true`) in `contracts.ts`; `profiles.ts` sets it.
- Tests: `app/src/api.claude-asset-publish.int.test.ts` (runs the scripts with `tsx` like the purge-user test).

## T-002 Publish, unpublish and the ref read API (AC-002, AC-003, AC-004, AC-006)

- `claude-assets.ts`: `publish(identity, assetId, versionId?)`, `unpublish`, `assetsForRef(ref)` (one query: `asset_refs`
  joined to `assets` (not hidden, published version = row's version) and the owner's verified person profile; grouped in code).
- Routes `claude-assets.$assetId.publish.ts`, `claude-assets.$assetId.unpublish.ts`, `claude-assets.ref.$ref.ts` (public,
  `cache-control: public, max-age=60`).
- Error `asset.not_verified` (403).
