---
id: "021"
title: Server container — pinned, non-root image with a health check, and a standalone Helm values sketch
status: approved
features: [OPS-021]
owner: "@Sefaria/sefaria-social-owners"
surfaces: []
risk: high
contract_impact: none
---

## Problem

The social server (the Start build) has no production way to run: the build emits a fetch handler and nothing serves it
outside tests. Plan section 7 asks for a Dockerfile, a values file for a standalone namespace and a deploy runbook, so a human
can do the infrastructure work. The image must be reproducible and safe to run: base images pinned, nothing fetched from an
unpinned URL, a non-root user, and a health check the orchestrator can use.

## Acceptance criteria

- AC-001 WHEN `release check-dockerfile` reads the Dockerfile THE SYSTEM SHALL pass only if every `FROM` names an exact version
  tag and a sha256 digest, no instruction fetches a URL (`ADD <url>`, `curl`, `wget`), the final stage sets a non-root `USER`,
  and a `HEALTHCHECK` calls `/api/v1/health`; each violation SHALL be reported with its line and the fix
- AC-002 WHEN the image runs with `DATABASE_URL` pointing at a migrated database THE SYSTEM SHALL answer `GET /api/v1/health`
  with 200 and an unauthenticated `GET /api/v1/rooms` with 401 on port 3200, report healthy to Docker, run as a non-root user,
  stop on SIGTERM within 10 seconds, and carry a migrate command that applies the committed migrations
- AC-003 WHEN the Helm values sketch is read THE SYSTEM SHALL name its own namespace, the image by digest, a non-root security
  context, liveness and readiness probes on `/api/v1/health`, and every environment variable the server reads, each taken from
  a ConfigMap or a Secret by name, with no secret value in the file

## Out of scope

- The chart itself, the gateway, DNS, certificates, the database and the registry (infrastructure, a human task; the
  infrastructure repository is not touched).
- Serving the surface bundle from the server (it is published to the asset target, spec 020).

## Notes for the planner

- `app/scripts/start.mjs` serves the built fetch handler over Node's http module (no new dependency) and the client assets
  from `dist/client`; `app/scripts/migrate.mjs` applies the migrations without tsx.
- The CI `container` job builds the image and runs it against the job's Postgres service.
