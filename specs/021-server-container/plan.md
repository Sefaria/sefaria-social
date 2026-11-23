# Plan: 021 server container

## Approach

A multi-stage `Dockerfile` at the root: a build stage (`npm ci`, `npm run build`, `npm prune --omit=dev`) and a runtime stage on
the same pinned Node image, running `node app/scripts/start.mjs` as the image's `node` user, with a `HEALTHCHECK` written in
Node (no curl in the image). `app/scripts/release/dockerfile.ts` checks the rules; `deploy/helm/values.yaml` sketches the
standalone deployment; the `container` job in ci.yml builds and runs the image.

## Tasks

- T-001 Dockerfile, production server entry, migrate command and the Dockerfile rules (AC-001, AC-002): `Dockerfile`,
  `.dockerignore`, `app/scripts/start.mjs`, `app/scripts/migrate.mjs`, `app/scripts/release/dockerfile.ts`,
  `app/scripts/release/cli.ts`, `app/scripts/container-smoke.sh`, `.github/workflows/ci.yml`, `factory/test/acceptance-021.test.mjs`
- T-002 Helm values sketch (AC-003): `deploy/helm/values.yaml`, `factory/test/acceptance-021.test.mjs`

## Tests

`factory/test/acceptance-021.test.mjs`: AC-001 drives the CLI on the real Dockerfile and on broken fixtures; AC-003 reads the
values file and the server's config module. AC-002 is the `container` CI job (`app/scripts/container-smoke.sh`), which needs
Docker; the acceptance test for AC-002 checks that ci.yml runs that script in a job that `result` needs.
