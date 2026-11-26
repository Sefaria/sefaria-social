# 0015. Claude assets: storage, serving contexts, staff tools and MCP tokens

- Status: proposed
- Date: 2026-11-27
- Deciders: proposed by the build session for specs 060–064 while the owner was away; the owner confirms by approving the
  specs, or changes any point here

## Context

Sefaria-Project's `LINKED_PANELS_AND_ASSETS_PLAN.md` (sections 2, 6, 7.1, 8) asks Social to store, serve, publish and list
interactive HTML "Claude assets". It leaves several choices to the spec. The plan and this repo disagree on two points: the
plan numbers Social's specs "087 onward", but 080–089 is the factory's range (`docs/runbooks/working-in-the-factory.md`) and
the last product spec is 059; and it calls the `shiurim` table unused, but the feed reads it (`services/feed.ts`).

## Decision

1. **Spec numbers 060–064.** Product specs continue after 059; 087 would sit in the factory's range.
2. **`shiurim` is reshaped by expansion only.** `teacher_user_id` stays and means the owner (a rename breaks a rolling deploy);
   `visibility` also allows `unlisted`, the default for a new shiur, as a ready recording is open to anyone with its link
   (decision 0011, D2). `shiur_recordings` stays until a later contract release removes it with its code.
3. **Assets are their own rows; a shiur pins a version** (plan P2 as taken). Deleting an asset unpins it everywhere.
4. **Idempotent saves without a key.** A save whose bytes equal the current version of the named asset, or of any of the
   caller's assets when none is named, answers that version (200) and stores nothing. This makes a retried save safe.
5. **Validation errors are a declared 422 body** (`problems[]` with stable codes and messages), not `ApiError`: `ApiError`
   messages are static by design and cannot name the bad ref, which the plan requires.
6. **Content contexts by path and signature.** The public URL `/api/v1/claude-assets/content/{versionId}` always gets the
   closed policy. The open (shiur) policy is served only at `/content/{versionId}/shiur/{grant}`, where the grant is
   `<shiurId>.<exp>.<HMAC>` with `ASSET_CONTENT_SECRET`, lives 30 minutes, and is honoured only while that shiur pins that
   version. Residual risk: an author can pin their own asset in their own shiur, take a fresh grant and hard-code it, and the
   asset, shown in the sidebar, could navigate its own sandboxed frame to it; the grant's 30-minute life and the pin check
   bound this, and sidebar authors are verified and can be taken down. The reader could close it fully by loading sidebar
   assets with `sandbox="allow-scripts"` and a `csp` attribute (CSP embedded enforcement), which is a reader-side choice.
7. **Frame ancestors reuse `SOCIAL_ALLOWED_ORIGINS`** (the reader's origins, already the CORS list). No new setting.
8. **Content origin.** `ASSET_CONTENT_ORIGIN` defaults to `http://127.0.0.1:3200`: in development Social serves content
   itself on a different host name than `localhost:3200`. When set, content routes answer 404 on any other origin.
9. **Staff tools are CLI scripts** (`verify-profile`, `asset-takedown`), like `purge-user`: having the server's database URL
   is what makes them staff-only. The token's `staff` claim stays unused, so no web request can grant a check mark.
10. **MCP tokens** carry `via: "mcp"`; endpoints opt in with `mcp: true`, allowed only for endpoints on a reviewed list
    (`MCP_ENDPOINTS`), and any other `via` value is an invalid token. The relay refuses any token with `via`.
11. **Ref expansion through a seam** (`services/sefaria-refs.ts`) calling Sefaria's `POST /api/refs/expand`, faked in tests by
    a local HTTP server with the same surface. `SEFARIA_API_ORIGIN` is new (no existing setting named the Sefaria API).

## Consequences

- Saving answers 503 `asset.refs_unavailable` until Sefaria's expand endpoint is deployed.
- A production content domain, `ASSET_CONTENT_SECRET`, the bucket adapter and the first verified authors are human steps
  (`docs/runbooks/setup-checklist.md`).
- Overrides plan section 8's "087 onward" (point 1) and refines 6.1's `shiurim` shape (point 2).
