# Deploying Sefaria Social

What a release does, what exists today, and what a human must set up before the first real release. Plan section 7; specs
019–021; decision [0010](../decisions/0010-release-pointer-and-container.md).

## The pieces

| Piece                                                   | Built by                | Served from (plan 9 D2 default)                          | Rolled back by                         |
| ------------------------------------------------------- | ----------------------- | -------------------------------------------------------- | -------------------------------------- |
| Surface bundle (loaded into the reader page)            | `npm run build:surface` | asset origin, e.g. `https://social.sefaria.org/surface/` | `scripts/rollback` (moves the pointer) |
| Social server (API, webhooks, health, standalone pages) | `Dockerfile`            | `social.sefaria.org`, own namespace and gateway route    | `helm rollback`                        |
| Relay (Cloudflare Worker)                               | `packages/relay`        | `rooms.sefaria.org` (wrangler)                           | `wrangler rollback`                    |

The reader finds the surface through `PUBLIC_SOCIAL_MANIFEST_URL` and refuses any file whose origin is not in
`PUBLIC_SOCIAL_ORIGINS`. The kill switch is the reader's lab `feature.reader.labs.social` in remote config: off means no reader
fetches the manifest at all.

## What a release does (`.github/workflows/release.yml`, on every push to main)

1. `npm ci`; version `<UTC date>-<run number>.<short sha>` (`npm run release -- version`).
2. Build the surface with that version; `npm run surface:budget`; keep the source maps as a private 30-day artifact.
3. **Rehearsal** (always runs): publish to a folder, serve it over HTTP, smoke-test over HTTP, promote, publish and promote a
   second build, `scripts/rollback`, and check the pointer is back on this version. This proves the pipeline on every commit.
4. **Upload** (`npm run release -- publish`) to `RELEASE_TARGET`. Skips with a notice without `RELEASE_TARGET` (variable) and
   `RELEASE_STORAGE_CREDENTIALS` (secret).
5. **Build the server image** (always; proves it builds) and check the Dockerfile rules.
6. **Push and deploy the server.** Skips with a notice without `SERVER_IMAGE_REPOSITORY`, `DEPLOY_WORKLOAD_IDENTITY_PROVIDER`
   and `DEPLOY_SERVICE_ACCOUNT` (variables). When they are set but the step has not been wired (below), it fails on purpose.
7. **Smoke-test** the uploaded version over HTTP (`release smoke --url <asset base>/v/<version>/manifest.json`) and the deployed
   server (`release smoke --server <API origin>`: health 200, rooms and feed 401). Needs `SOCIAL_ASSET_BASE_URL` and
   `SOCIAL_API_ORIGIN` (variables).
8. **Promote**: `release promote <version>` re-checks every hash through the target and moves `stable/manifest.json`; then the
   stable URL is smoke-tested. The previous stable version becomes the last known-good.

Runs share the concurrency group `release` and never cancel each other.

## Rollback

- **Surface:** `RELEASE_TARGET=… scripts/rollback` (last known-good) or `scripts/rollback <version>` (a named known-good
  version). From GitHub: run the `release` workflow by hand with `rollback_to` = `last` or a version. Readers get the old
  version on their next page load (the pointer is `no-cache`; versioned files are immutable, so nothing else changes). The
  rolled-back version is never promoted again: ship the fix as a new version.
- **Faster than a rollback:** turn the lab off in remote config (`feature.reader.labs.social`).
- **Server:** `helm rollback sefaria-social <revision> -n sefaria-social`. Migrations are forward-only: a release that migrates
  must keep the previous server working against the new schema.
- `npm run release -- status` shows the current, known-good and rolled-back versions. Rehearsed locally:
  [rollback-rehearsal-local.md](rollback-rehearsal-local.md).

## Before the first real release (human tasks)

Plan 9 says who does the infrastructure work and when is still open. In order:

1. **Asset storage.** Choose the store and origin (default `social.sefaria.org/surface/`, or a separate assets host). It must
   serve each object with the content type and `Cache-Control` the release sets, and `Access-Control-Allow-Origin` for the
   reader's origins (or `*`) on the manifest, JS and CSS. Implement `BucketTarget` in `app/scripts/release/storage.ts` for it
   (`get`, `put` with content type and cache header, `list`). Set `RELEASE_TARGET=bucket:<name>` (variable) and
   `RELEASE_STORAGE_CREDENTIALS` (secret; or switch the job to workload identity).
2. **Registry and identity.** An image repository (Artifact Registry follows the pattern of the other standalone apps), a
   service account allowed to push to it, and the workload identity pool condition extended to
   `Sefaria/sefaria-social/.github/workflows/release.yml` on `refs/heads/main`. Set `SERVER_IMAGE_REPOSITORY`,
   `DEPLOY_WORKLOAD_IDENTITY_PROVIDER` and `DEPLOY_SERVICE_ACCOUNT` (variables). This is the infrastructure repository's work;
   this repository does not touch it.
3. **Wire the deploy step.** Replace the body of "Push the image and deploy the server" in `release.yml` with: authenticate
   (`google-github-actions/auth` pinned to a full commit SHA, `id-token: write` on the job), `docker push` the image tagged with
   the version, read its digest, and hand the digest to the cluster (a Flux image policy or an infrastructure-repo PR, whichever
   the other standalone apps use).
4. **Namespace and chart.** `deploy/helm/values.yaml` is a sketch for a standalone namespace (`sefaria-social`): image by digest,
   non-root security context, probes on `/api/v1/health`, migrations as a pre-upgrade Job with the same image
   (`node app/scripts/migrate.mjs`), every server variable from the ConfigMap `sefaria-social-config` or the Secret
   `sefaria-social-secrets`. If `readOnlyRootFilesystem` breaks anything, mount an `emptyDir` at `/tmp`.
5. **Database.** A Postgres for social (D3); its URL in the Secret as `DATABASE_URL`.
6. **Secrets shared with Django and the relay:** `USER_DELETED_WEBHOOK_SECRET` (Django's), `RELAY_INTERNAL_SECRET` (the
   relay's); the JWKS URL and issuer in the ConfigMap (see `server.md`).
7. **The reader's configuration:** `PUBLIC_SOCIAL_MANIFEST_URL=<asset origin>/surface/stable/manifest.json`,
   `PUBLIC_SOCIAL_ORIGINS=<asset origin>`, `PUBLIC_SOCIAL_API_ORIGIN`, `PUBLIC_SOCIAL_RELAY_ORIGIN`, `PUBLIC_SOCIAL_ENVIRONMENT`
   in the reader's Helm values (none are set yet).
8. **First staging release and rollback**, recorded next to the local one (plan 8 P5's original exit test).

## Running the image locally

```
docker build -t sefaria-social-server .
docker run --rm --network host -e DATABASE_URL=postgres://… sefaria-social-server node app/scripts/migrate.mjs
docker run --rm -p 3200:3200 -e DATABASE_URL=postgres://host.docker.internal:5432/sefaria_social sefaria-social-server
DATABASE_URL=… app/scripts/container-smoke.sh sefaria-social-server   # what CI's container job runs (Linux host network)
```

Without Docker: `npm run build && node app/scripts/start.mjs` (PORT, HOST; the server's variables are in `server.md`).
