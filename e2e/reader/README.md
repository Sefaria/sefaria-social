# L4b: the rooms journeys against the real reader (disabled)

The same journey as `e2e/rooms.spec.ts`, against the reader (`reader-next`) with the social lab on, instead of the harness.
Plan 5.5 runs it in the merge queue and nightly. It is **not** run by `npm run test:e2e` (the root Playwright config ignores
`e2e/reader/**`) and has no CI job here, because it needs the reader seam (Sefaria-Project PR 4122, milestone A1) merged and
a reader image to run.

To run it by hand once A1 is merged:

1. Start the local stack (`npm run build && npx tsx e2e/stack/start.ts`) and the surface's dev server or a built surface.
2. Start the reader with `PUBLIC_LABS=social`, `PUBLIC_SOCIAL_DEV_ENTRY=<surface entry>`, `PUBLIC_SOCIAL_API_ORIGIN=http://127.0.0.1:3200`,
   `PUBLIC_SOCIAL_RELAY_ORIGIN=ws://127.0.0.1:8787`, and the stack's JWKS/issuer configured on the Django side.
3. `READER_URL=http://localhost:3100 npx playwright test -c e2e/reader/playwright.config.ts`.

Open points for whoever enables it: signing in two reader sessions (Django test users, not the harness's injected tokens),
and a reader move that keeps `ctx` (the reader's own next-chapter control).
