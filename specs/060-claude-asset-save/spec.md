---
id: "060"
title: Save a Claude asset by file or URL, its manifest and refs checked, as immutable versions in the object store
status: proposed
features: [SHIUR-008, SHIUR-009]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api]
risk: high
contract_impact: api-minor
---

## Problem

The owner decided (Sefaria-Project `LINKED_PANELS_AND_ASSETS_PLAN.md`, D5, D8, D11) that an interactive HTML page made in
Claude (a "Claude asset") is kept by Social: Sefaria hosts its own immutable copy of every version, the live Claude URL is only
a source link, and there are three ways in: the MCP tool, a file upload and an import from a URL. Each asset declares the
Sefaria refs it covers in a manifest inside the file (plan 5.1), and Social has no text library, so it asks Sefaria to check
and expand them (plan 6.5). Today Social stores no such thing.

## Acceptance criteria

- AC-001 WHEN a signed-in user posts `{html}` to `POST /api/v1/claude-assets` with one valid manifest THE SYSTEM SHALL ask
  Sefaria to check and expand every declared ref, keep the file in the object store under `assets/<assetId>/<sha256>.html`,
  create the asset and its version 1 with the normalized manifest (each ref with its normal form, Hebrew form, section refs and
  segment refs), and answer 201 with the asset and the version; the title and description come from the manifest, never from
  the caller
- AC-002 WHEN the body carries the `assetId` of one of the caller's assets THE SYSTEM SHALL add the next version (n + 1) and
  make it current; an `assetId` that is unknown or belongs to someone else SHALL be 404 and nothing stored; posting the same
  bytes as the asset's current version (or, without `assetId`, as the current version of one of the caller's assets) SHALL
  answer 200 with that version and store nothing new
- AC-003 WHEN the file is larger than `ASSET_MAX_BYTES` (5 MB by default), has no `<script type="application/json"
id="sefaria-asset">` block or more than one, holds invalid JSON there, a `v` other than 1, no title, no refs, or a ref
  Sefaria does not know THE SYSTEM SHALL answer 422 with `error.code` `asset.invalid` and a `problems` list whose entries
  each have a stable `code` and a message that says what to change (an invalid ref names the ref), and store nothing
- AC-004 WHEN the body has `dryRun: true` THE SYSTEM SHALL run every check and answer 200 with the normalized manifest, the
  size and the hash, store nothing, and not count it toward the daily limit
- AC-005 WHEN a user has already saved `ASSET_DAILY_LIMIT` (20 by default) new versions in the last 24 hours THE SYSTEM SHALL
  refuse the next save with 429 `asset.daily_limit` and store nothing
- AC-006 WHEN Sefaria cannot be asked (no answer within 10 seconds, an error status, or an answer that does not match its
  schema) THE SYSTEM SHALL answer 503 `asset.refs_unavailable` and store nothing
- AC-007 WHEN a signed-in user posts `{url}` to `POST /api/v1/claude-assets/import` THE SYSTEM SHALL fetch it once and save it
  by the path of AC-001 to AC-006, keeping the URL as `sourceUrl` (shown, never fetched again, never embedded); it SHALL
  refuse with 422 and a problem code, before or instead of fetching: a URL that is not `https`; a `claude.ai` or
  `claudeusercontent.com` URL (or a subdomain), with a message that names the two working routes (the Sefaria connector in
  Claude, "save this to Sefaria", and downloading the file and uploading it); a host that resolves to a private, loopback,
  link-local, unique-local, carrier-grade NAT or cloud metadata address; any redirect; an answer that is not `text/html`;
  and a body that passes the size limit while it is read
- AC-008 WHEN anyone asks for `GET /api/v1/claude-assets/{assetId}` THE SYSTEM SHALL answer with the asset's title,
  description, author (name, profile id, whether verified), source URL, current and published version ids, its versions and
  the current manifest, and no Sefaria user id; a hidden or unknown asset SHALL be 404; `GET /api/v1/claude-assets` SHALL list
  the caller's own assets, hidden ones included and marked
- AC-009 WHEN the owner deletes an asset with `DELETE /api/v1/claude-assets/{assetId}`, or the owner's account is deleted,
  THE SYSTEM SHALL remove the asset, its versions and every file under `assets/<assetId>/`; anyone else SHALL get 404

## Out of scope

- Serving the file's content (spec 061), publishing and the ref read API (spec 062), shiurim, posts and profiles (spec 063),
  MCP tokens (spec 064).
- A cloud bucket adapter: the existing `ObjectStore` is used (plan 6.2); the bucket is a known gap shared with recordings.
- Sefaria's `POST /api/refs/expand` itself (Sefaria-Project). Until it is deployed, saving answers 503 everywhere but tests.
- Editing an asset's title outside its file; restoring a deleted asset.

## Notes for the planner

- Tables (expand only): `assets` (id uuid, owner_user_id, title, description, lang, source_url, current_version_id,
  published_version_id, hidden, hidden_at, created_at, updated_at) and `asset_versions` (id, asset_id, n, sha256, storage_key,
  bytes, manifest jsonb, created_at; unique (asset_id, n) and (asset_id, sha256)). Owner and both version pointers are
  deleted with the asset; `deleteUserData` deletes the owner's assets and the sweep removes orphaned `assets/<id>/` prefixes.
- The Sefaria client is a seam (`server/services/sefaria-refs.ts`): `POST {SEFARIA_API_ORIGIN}/api/refs/expand` with
  `{"refs": [...]}` (at most 200), answer `{"results": [{"input", "ok": true, "ref", "heRef", "sectionRefs", "segmentRefs"}
| {"input", "ok": false, "error"}]}`, validated with zod, 10-second timeout. Tests fake Sefaria by that real HTTP surface
  (a local server), never by replacing the function.
- `SEFARIA_API_ORIGIN` (default `https://www.sefaria.org`), `ASSET_MAX_BYTES` (5242880), `ASSET_DAILY_LIMIT` (20),
  `ASSET_MAX_SEGMENTS` (2000; a manifest that expands to more is `refs.too_broad`).
- The daily count and the insert run under one advisory lock per user, so two parallel saves cannot pass the limit.
- The manifest parser is pure (`lib/asset-manifest.ts`): one exact-attribute script block, JSON, zod. It never runs the file.
- Import (`server/services/asset-import.ts`): resolve once with `dns.lookup(all)`, refuse if any address is in a refused range,
  connect with `https.request` whose `lookup` returns that address (SNI and certificate checked against the host name), no
  redirects, 10-second limit, `content-type` must be `text/html`, the size limit counted while streaming. The refused ranges
  are a pure function with unit tests (IPv4, IPv6, IPv4-mapped IPv6).
- Problem codes: `size.too_large`, `manifest.missing`, `manifest.multiple`, `manifest.json`, `manifest.version`,
  `manifest.invalid`, `refs.missing`, `refs.too_many`, `refs.too_broad`, `ref.invalid`, `import.https_only`,
  `import.claude_link`, `import.address_refused`, `import.redirect`, `import.not_html`, `import.fetch_failed`,
  `import.invalid_url`.
- Save answer (201, or 200 when unchanged): `{asset: ClaudeAsset, version: {id, n, sha256, bytes, createdAt}, created,
unchanged, firstRef}`. Dry run (200): `{dryRun: true, manifest, bytes, sha256, firstRef}`. Refusal (422):
  `{error: {code: "asset.invalid", message}, problems: [{code, message, ref?}]}`.
- Request body cap for the save route: 12 MiB of JSON (the file's own limit is checked on its UTF-8 bytes after parsing).
