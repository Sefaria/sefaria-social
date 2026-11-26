---
id: "061"
title: Serve a Claude asset's file sandboxed from its own origin, its network closed or open by a context the server decides
status: proposed
features: [SHIUR-010]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [api]
risk: high
contract_impact: api-minor
---

## Problem

A Claude asset is active code written by someone else, shown beside the text (plan 6.6). The reader will load it in an iframe
with `sandbox="allow-scripts"` (Phase 2), but a direct visit to the file's URL must be just as contained, the file must never
share an origin with Sefaria or the Social API, and its network access depends on where it is shown (D7): inside a shiur
anything is allowed; in the sidebar and on public pages nothing is, except an optional list of trusted CDNs. The context must
be one the server decides, not a query string a page (or the asset itself) can change.

## Acceptance criteria

- AC-001 WHEN anyone asks for a version's public URL, `GET /api/v1/claude-assets/content/{versionId}` THE SYSTEM SHALL answer
  the stored bytes as `text/html; charset=utf-8` with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a
  `Content-Security-Policy` that starts with `sandbox allow-scripts`, has `frame-ancestors` listing exactly the origins in
  `SOCIAL_ALLOWED_ORIGINS` (`'none'` when unset), `default-src 'none'`, inline script and style, images and media from `data:`
  and `blob:` only, and no `connect-src`
- AC-002 WHILE `ASSET_TRUSTED_CDNS_ENABLED` is `true` THE SYSTEM SHALL add each host in `ASSET_TRUSTED_CDNS` (default
  `cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, fonts.googleapis.com, fonts.gstatic.com`) as `https://<host>` to
  `script-src`, `style-src` and `font-src` of the public policy; while it is anything else (the default is off) no host is added
- AC-003 WHEN a version is pinned in a shiur (spec 063) THE SYSTEM SHALL give it, in the shiur's answer, a shiur URL
  `GET /api/v1/claude-assets/content/{versionId}/shiur/{grant}` whose grant names the shiur and an expiry and is signed with
  `ASSET_CONTENT_SECRET`; that URL SHALL answer the same bytes with the open policy (`sandbox allow-scripts`, the same
  `frame-ancestors`, and every source allowed); a grant that is unsigned, signed for another version, expired, or for a shiur
  that no longer pins this version SHALL be 404
- AC-004 WHEN `ASSET_CONTENT_ORIGIN` is set and a content URL is asked for on any other origin THE SYSTEM SHALL answer 404;
  every `contentUrl` the API gives is built on `ASSET_CONTENT_ORIGIN`
- AC-005 WHEN the asset is hidden or deleted, or the version is unknown THE SYSTEM SHALL answer 404 at both URLs; the public
  URL SHALL be cacheable for at most 5 minutes (`public, max-age=300`) and the shiur URL only privately
- AC-006 WHEN anyone asks for an asset (`GET /api/v1/claude-assets/{assetId}`) or saves one THE SYSTEM SHALL give each version
  its public `contentUrl`

## Out of scope

- Choosing the production content domain, its TLS and DNS (a human step, setup checklist), and the reader's iframe (Phase 2).
- A CDN in front of the content origin.

## Notes for the planner

- Settings: `ASSET_CONTENT_ORIGIN` (default `http://127.0.0.1:3200`: in development the Social server itself on a different
  host name than `localhost:3200`, so the file never shares the API's origin; production must set a separate registrable
  domain), `ASSET_CONTENT_SECRET` (HMAC key; unset means no shiur URL is issued and every grant is refused),
  `ASSET_TRUSTED_CDNS`, `ASSET_TRUSTED_CDNS_ENABLED`. Frame ancestors reuse `SOCIAL_ALLOWED_ORIGINS` (the reader's origins).
- Grant: `<shiurId>.<exp unix seconds>.<base64url HMAC-SHA256 over "shiur:<shiurId>:<versionId>:<exp>">`, 30-minute lifetime,
  compared in constant time. A short life limits an author who copies a grant into their own file: the asset could navigate
  its own frame to it, so an expired grant must not work (decision 0015).
- The endpoint wrapper's binary responses gain a short list of security headers a handler may set (`content-security-policy`,
  `x-content-type-options`, `referrer-policy`, `cache-control`); nothing else.
- Both content routes are on the public list with their reason.
