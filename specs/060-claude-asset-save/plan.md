# Plan: 060 save a Claude asset

Source: Sefaria-Project `LINKED_PANELS_AND_ASSETS_PLAN.md` sections 5.1, 6.1–6.5. Decision: `docs/decisions/0015-claude-assets.md`.

## T-001 Save, versions, checks, reads and deletion (AC-001 to AC-006, AC-008, AC-009)

- `lib/asset-manifest.ts` (pure): find exactly one `<script type="application/json" id="sefaria-asset">` block (attributes in
  any order, quotes either way), parse JSON, check with zod (`v: 1`, `title` 1–200, `description` ≤ 1000, `lang` optional,
  `refs` 1–100 of `{ref, label?}`); every failure is a problem `{code, message}`.
- `server/services/sefaria-refs.ts`: the expand client, zod on the answer, 10-second timeout, `RefsUnavailable` on any failure;
  `sectionOf(segment, sectionRefs)`.
- `server/services/claude-assets.ts`: `saveAsset(identity, {html, assetId?, sourceUrl?, dryRun?})` → size, manifest, refs
  (expand, segment cap), then under `pg_advisory_xact_lock(hashtext('claude-assets'), userId)`: owner check, unchanged check
  by sha256, daily count over `asset_versions` joined to `assets` in the last 24 hours, file put to the object store, rows.
  `getAsset`, `listMine`, `deleteAsset`; DTO builder shared by every route.
- Migration `0014_claude_assets.sql` (generated): `assets`, `asset_versions`; foreign keys indexed.
- `users.ts`: delete the user's assets; `recordings.ts`' sweep also removes `assets/<id>/` prefixes with no row.
- Routes: `claude-assets.ts` (GET mine, POST save), `claude-assets.$assetId.ts` (GET public, DELETE owner). Public list
  entry for `GET /api/v1/claude-assets/{assetId}`.
- Errors: `asset.invalid` (422 body), `asset.not_found`, `asset.daily_limit`, `asset.refs_unavailable`.
- Tests: `app/src/api.claude-assets.int.test.ts` with `test/integration/fake-sefaria.ts` (a local HTTP server answering
  `/api/refs/expand`), `lib/asset-manifest.test.ts`. The schema walk seeds the new tables.

## T-002 Import from a URL (AC-007)

- `server/services/asset-import.ts`: `refusedAddress(ip)` (pure, IPv4 and IPv6 ranges), `checkImportUrl(url)`,
  `fetchAsset(url, opts)` with injected `resolve` and `allow` for tests; real defaults: `dns.lookup(all)`, the refused ranges,
  `https.request` with a `lookup` that answers only the checked address. `setImportFetcher` lets the integration test
  answer a page without the network; the unit test runs the real fetcher against a local HTTPS server (a key and certificate
  made with `openssl` for the test) to prove the pinned connection, the redirect refusal and the streaming cap.
- Route `claude-assets.import.ts`, body `{url, assetId?, dryRun?}`.
- Tests: `server/services/asset-import.test.ts`, `app/src/api.claude-assets-import.int.test.ts`.
