# Security notes for releasing and running social

Plan section 7 and 1.3; decision [0010](../decisions/0010-release-pointer-and-container.md).

## The surface runs as the reader, so it must be first-party

The surface bundle executes inside the reader page with the signed-in user's session and the reader's origin. Loading it is a
first-party trust decision: **only Sefaria-owned surfaces, built from this repository by its own release workflow, are ever
loaded. Never a third-party surface**, and never a manifest or file from an origin Sefaria does not control.

What enforces it today:

- The reader loads only from `PUBLIC_SOCIAL_MANIFEST_URL`, and only files whose resolved origin is in `PUBLIC_SOCIAL_ORIGINS`
  (fails closed: unset loads nothing), over https (http only on localhost).
- Every file has a Subresource Integrity hash in the manifest (entry, each chunk, the stylesheet); the reader preloads each with
  its hash and the module map refuses an altered file. Shown in Chromium by A1's e2e and by `e2e/release.spec.ts` (an altered
  chunk stops the load). Not yet checked in Firefox or Safari.
- The release refuses to publish a build whose files do not match their hashes, never overwrites a published version, and
  smoke-tests every hash again before moving the pointer.
- The lab `feature.reader.labs.social` is the kill switch.

The integrity hashes protect against a changed file at the asset origin, not against a changed manifest: whoever can write
`stable/manifest.json` can point readers at other code on an allowed origin. **Write access to the asset store is equivalent to
running code as every reader.** Keep it to the release workflow's identity (main branch only) and the few people who can run
`scripts/rollback`.

## Content-Security-Policy

**The reader sends no Content-Security-Policy today** (plan 7, verified in the reader). When it adds one, it must list:

- `script-src`: the social asset origin (module scripts and modulepreload);
- `style-src`: the social asset origin (the surface's stylesheet);
- `connect-src`: the asset origin (manifest fetch), `PUBLIC_SOCIAL_API_ORIGIN` (https) and `PUBLIC_SOCIAL_RELAY_ORIGIN` (wss).

The surface has no inline scripts or inline event handlers. One thing to know: zod (the schema library in the bundle) probes
once with `Function("")` inside a try/catch and, when the page allows it, compiles faster object parsers. Under a CSP without
`unsafe-eval` the probe fails and zod falls back to its interpreter, so **no `unsafe-eval` is needed**, but the probe may log one
CSP violation report. If that report is noisy, set zod's `jitless` option in the surface entry rather than allowing `unsafe-eval`.

## The server

- Bearer tokens only, no cookies (D2); every route is protected unless it is on the public list (`/api/v1/health` today;
  spec 006). CORS allows only `SOCIAL_ALLOWED_ORIGINS`.
- The image is built from the lockfile with install scripts off, on a base pinned by digest, and runs as a non-root user; the
  Helm values add a read-only root filesystem, no privilege escalation and all capabilities dropped.
- Secrets (`DATABASE_URL`, `USER_DELETED_WEBHOOK_SECRET`, `RELAY_INTERNAL_SECRET`) come from a Kubernetes Secret, never from
  the image or the values file. The configuration module never logs a value.

## Source maps

Source maps are not published with the surface (they would show the source to anyone). They are kept as a 30-day artifact of
each release run, for debugging reported errors.
