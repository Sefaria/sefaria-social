---
id: "022"
title: Coolify deployment — a shared dev backend and a full preview per pull request
status: proposed
features: [OPS-022]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

Sefaria's test environments are cauldrons, and the reader in a cauldron needs a Social backend to talk to: the surface bundle,
the server and the relay. Production's home (spec 021, docs/runbooks/deploy.md) does not exist yet, and a cauldron should be able
to try any pull request's Social without a deploy per branch. The Library Assistant already works this way on Coolify: one app
whose main deployment is the shared dev server, and a preview per pull request at `<pr>.<domain>`, chosen per page by the reader.

## Acceptance criteria

- AC-001 WHEN `docker-compose.coolify.yml` is read THE SYSTEM SHALL define the services `app`, `surface`, `relay` and `postgres`:
  `app` built from the repository's Dockerfile, applying the committed migrations before it serves and reaching the database and
  the relay by service name; `postgres` an image pinned by tag and sha256 digest with a health check that `app` waits for; and
  every secret given as a `${VARIABLE}` reference (Coolify's generated `SERVICE_PASSWORD_*` or a variable set on the app), never
  a literal value
- AC-002 WHEN the surface image is built THE SYSTEM SHALL build the surface with the release build, serve its `manifest.json` with
  `Cache-Control: no-cache` and its hashed files under `/assets/` as immutable, allow any origin on every response, run as a
  non-root user from base images pinned by tag and sha256 digest, and report its health from the manifest
- AC-003 WHEN the relay image starts THE SYSTEM SHALL run the Worker in workerd from base images pinned by tag and sha256 digest,
  as a non-root user, taking `ALLOWED_ORIGINS`, `JWKS_URL`, `TOKEN_ISSUER` and `RELAY_INTERNAL_SECRET` from its environment at
  start (refusing to start when one is missing) and baking none of them into the image, and report its health from `/health`

## Out of scope

- Creating the Coolify app, its domains and its variables (a human or an operator with Coolify access; recorded in
  docs/runbooks/previews.md).
- The reader's per-page choice of a preview (`?social_version=<pr>`), which is reader-next's change.
- Production (docs/runbooks/deploy.md): the relay there runs on Cloudflare and the surface on the asset origin.

## Notes for the planner

- A variable set on a Coolify app applies to every preview of that app, so nothing in the compose file may be specific to one
  pull request; Coolify generates `SERVICE_PASSWORD_*` per deployment.
- Coolify reads the compose file from the app's branch, so a new service reaches previews only after it merges.
