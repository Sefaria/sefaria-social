# Plan: 061 serve a Claude asset's content

Source: `LINKED_PANELS_AND_ASSETS_PLAN.md` 6.6 and D7. Decision: `docs/decisions/0015-claude-assets.md` (points 6–8).

## T-001 Two content routes, two policies, the content origin (AC-001 to AC-006)

- `server/services/asset-content.ts` (no database): `publicPolicy(cfg)`, `shiurPolicy(cfg)`, `frameAncestors(cfg)`,
  `contentUrl(versionId)`, `shiurGrant(shiurId, versionId, now)`, `checkGrant(grant, versionId, now)` (constant-time compare),
  `onContentOrigin(request)`.
- `claude-assets.ts` service: `contentOf(versionId)` (404 for hidden, deleted, unknown), `pinnedIn(shiurId, versionId)` (reads
  `shiur_assets` once spec 063 adds it; until then always false), version DTOs carry `contentUrl`.
- `endpoint.ts`: binary responses may set `content-security-policy`, `x-content-type-options`, `referrer-policy` and
  `cache-control`; unit test in `server/http/endpoint.test.ts`.
- Routes `claude-assets.content.$versionId.ts` and `claude-assets.content.$versionId.shiur.$grant.ts`, public, on the public
  list. Settings in `config.ts`.
- Tests: `app/src/api.claude-asset-content.int.test.ts`, `server/services/asset-content.test.ts`.
